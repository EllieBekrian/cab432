// config.js
console.log("Config.js is being loaded");

const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
require("dotenv").config();

const awsRegion = process.env.AWS_REGION || "ap-southeast-2";

// فقط از IAM Role روی EC2 استفاده می‌کنیم (بدون credentials صریح)
const secretsManager = new SecretsManagerClient({ region: awsRegion });

// خواندن سکریت (اختیاری). اگر ست نشده بود یا JSON نبود، خروجی خالی می‌دهیم.
const getSecret = async (secretName) => {
  if (!secretName) return {};
  try {
    const data = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    if (data.SecretString) {
      try { return JSON.parse(data.SecretString); }
      catch { return {}; }
    }
    return {};
  } catch {
    // اگر دسترسی به سکریت نداریم یا تنظیم نشده بود، مشکلی نیست.
    return {};
  }
};

const loadConfig = async () => {
  const secrets = await getSecret(process.env.AWS_SECRETS_NAME);

  // ⚠️ فقط از ENV می‌خوانیم؛ Parameter Store حذف شد.
  const s3BucketName = (process.env.S3_BUCKET_NAME || "").trim();
  if (!s3BucketName) {
    throw new Error(
      "S3_BUCKET_NAME is required. Set it in your .env, e.g. S3_BUCKET_NAME=cab432-n11880571-assessment2"
    );
  }

  const config = {
    awsRegion,
    // اگر سکریت موجود نبود، از ENV می‌خوانیم؛ نبودشان هم برای DEV مشکلی ندارد.
    cognitoClientId: secrets.cognitoClientId || process.env.COGNITO_CLIENT_ID || null,
    cognitoUserPoolId: secrets.cognitoUserPoolId || process.env.COGNITO_USER_POOL_ID || null,

    s3BucketName,
    dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME || "app_data",
  };

  console.log("Configuration loaded successfully.");
  return config;
};

module.exports = { loadConfig };
