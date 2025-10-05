// database.js
const {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
  ScanCommand,
} = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const {
  cacheFileMetadata,
  getCachedFileMetadata,
  initializeMemcachedClient, // Memcached wrapper
} = require("../redisClient");

const { loadConfig } = require("../config.js");
require("dotenv").config();

let dynamodb;
let dynamoDbDocumentClient;
let memcachedClient;

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || "app_data";

// ---- Memcached init ----
const initializeCache = async () => {
  memcachedClient = await initializeMemcachedClient();
  console.log("Memcached client initialized successfully");
};
initializeCache().catch((err) => {
  console.error("Failed to initialize Memcached:", err);
});

// ---- DynamoDB init ----
const initializeDynamoDB = async () => {
  try {
    const config = await loadConfig();

    // Use region only; credentials از IAM Role روی EC2 خوانده می‌شود
    dynamodb = new DynamoDBClient({
      region: config.awsRegion,
    });

    dynamoDbDocumentClient = DynamoDBDocumentClient.from(dynamodb);
    console.log("DynamoDB client initialized successfully");
  } catch (err) {
    console.error("Error initializing DynamoDB client:", err);
    throw new Error("Failed to initialize DynamoDB client.");
  }
};
initializeDynamoDB().catch((err) => {
  console.error("Failed to initialize DynamoDB:", err);
});

// ---- Users ----
const saveUser = async (username, password, role, callback) => {
  const params = {
    TableName: TABLE_NAME,
    Item: marshall({
      user: username, // partition key
      username: username,
      password: password,
      role: role || "user",
    }),
  };

  try {
    await dynamodb.send(new PutItemCommand(params));
    console.log("User data saved to DynamoDB");
    if (typeof callback === "function") callback(null);
  } catch (err) {
    console.error("Error saving user data:", err.stack || err);
    if (typeof callback === "function") callback(err);
  }
};

const saveUserActivity = async (username, activity) => {
  const params = {
    TableName: TABLE_NAME,
    Item: marshall({
      user: username,
      activityId: `ACTIVITY#${Date.now()}`,
      activity: activity,
      timestamp: new Date().toISOString(),
    }),
  };

  try {
    await dynamodb.send(new PutItemCommand(params));
    console.log(`User activity saved: ${activity} for user ${username}`);
  } catch (err) {
    console.error("Error saving user activity:", err.stack || err);
  }
};

// ---- Files ----
const getFileMetadata = async (username) => {
  const cachedMetadata = await getCachedFileMetadata(username);
  if (cachedMetadata) {
    console.log("Returning cached file metadata for", username);
    return cachedMetadata;
  }

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: "#user = :user",
    ExpressionAttributeNames: { "#user": "user" },
    ExpressionAttributeValues: { ":user": { S: username } },
  };

  try {
    const data = await dynamodb.send(new QueryCommand(params));
    if (!data.Items || data.Items.length === 0) {
      console.log("No files found for user:", username);
      return [];
    }

    const files = data.Items.map((item) => unmarshall(item)).filter((x) => x.fileName);
    if (files.length > 0) {
      await cacheFileMetadata(username, files);
    }

    return files;
  } catch (err) {
    console.error("Error fetching file metadata:", err.stack || err);
    return [];
  }
};

const saveFileMetadata = async (fileMetadata) => {
  const params = {
    TableName: TABLE_NAME,
    Item: marshall({
      user: fileMetadata.user,
      fileName: fileMetadata.fileName,
      size: fileMetadata.size,
      format: fileMetadata.format || null,
      resolution: fileMetadata.resolution || null,
      uploadTime: fileMetadata.uploadTime || new Date().toISOString(),
    }),
  };

  try {
    await dynamodb.send(new PutItemCommand(params));
    console.log("File metadata saved to DynamoDB");

    let existing = await getCachedFileMetadata(fileMetadata.user);
    if (!existing) existing = [];
    existing.push(fileMetadata);
    await cacheFileMetadata(fileMetadata.user, existing);

    console.log("File metadata cached in Memcached");
  } catch (err) {
    console.error("Error saving file metadata:", err.stack || err);
  }
};

// ---- Progress ----
const saveProgress = async (username, fileName, progressData) => {
  const cacheKey = `progress:${username}:${fileName}`;
  try {
    const params = {
      TableName: TABLE_NAME,
      Item: marshall({
        user: username,
        fileName: fileName,
        progress: progressData,
        lastUpdated: new Date().toISOString(),
      }),
    };

    await dynamodb.send(new PutItemCommand(params));

    // assuming initializeMemcachedClient returns promise-wrapped client:
    await memcachedClient.set(cacheKey, JSON.stringify(progressData), { expires: 3600 });
    console.log(`Progress data saved for ${username} - ${fileName}`);
  } catch (err) {
    console.error("Error saving progress:", err.stack || err);
  }
};

const getProgress = async (username, fileName) => {
  const cacheKey = `progress:${username}:${fileName}`;
  try {
    // 1) try cache
    const cached = await memcachedClient.get(cacheKey);
    if (cached) {
      console.log(`Returning cached progress for ${username} - ${fileName}`);
      // if client returns string directly:
      return JSON.parse(typeof cached === "string" ? cached : cached.toString());
    }

    // 2) fallback to DynamoDB (DocumentClient uses plain JS values)
    const params = {
      TableName: TABLE_NAME,
      Key: { user: username, fileName: fileName },
    };
    const { Item } = await dynamoDbDocumentClient.send(new GetCommand(params));

    if (Item) {
      await memcachedClient.set(cacheKey, JSON.stringify(Item), { expires: 3600 });
      console.log(`Returning progress data for ${username} - ${fileName}`);
      return Item;
    } else {
      console.log(`No progress data found for ${username} - ${fileName}`);
      return null;
    }
  } catch (err) {
    console.error(`Error fetching progress for ${username} - ${fileName}:`, err);
    return null;
  }
};

// ---- Queries ----
const getAllFiles = async () => {
  const params = {
    TableName: TABLE_NAME,
    FilterExpression: "attribute_exists(fileName)",
  };

  try {
    const data = await dynamodb.send(new ScanCommand(params));
    if (!data.Items || data.Items.length === 0) {
      console.log("No files found in DynamoDB.");
      return [];
    }
    return data.Items.map((item) => unmarshall(item));
  } catch (err) {
    console.error("Error fetching files from DynamoDB:", err.stack || err);
    return [];
  }
};

const deleteFile = async (username, fileName) => {
  const params = {
    TableName: TABLE_NAME,
    Key: marshall({ user: username, fileName: fileName }),
  };

  try {
    await dynamodb.send(new DeleteItemCommand(params));
    console.log(`File metadata deleted for ${fileName} uploaded by ${username}`);
  } catch (err) {
    console.error("Error deleting file metadata:", err.stack || err);
    throw err;
  }
};

const getAllUsers = async () => {
  const params = {
    TableName: TABLE_NAME,
    FilterExpression: "attribute_exists(username)", // فقط رکوردهایی که username دارند
  };

  try {
    const data = await dynamodb.send(new ScanCommand(params));
    if (!data.Items || data.Items.length === 0) {
      console.log("No users found.");
      return [];
    }

    const users = data.Items.map((item) => unmarshall(item));
    const uniqueUsers = {};

    users.forEach((user) => {
      if (user.username) {
        uniqueUsers[user.username] = {
          username: user.username,
          role: user.role || "user",
        };
      }
    });

    return Object.values(uniqueUsers);
  } catch (err) {
    console.error("Error fetching all users:", err.stack || err);
    return [];
  }
};

// ---- Exports ----
module.exports = {
  saveUser,
  saveUserActivity,
  saveFileMetadata,
  saveProgress,
  getFileMetadata,
  getProgress,
  getAllFiles,
  deleteFile,
  getAllUsers,
};

