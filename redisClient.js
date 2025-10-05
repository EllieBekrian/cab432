const memjs = require('memjs');
require('dotenv').config();

const memcachedClient = memjs.Client.create('n11521147-a2-ech.km2jzi.cfg.apse2.cache.amazonaws.com:11211', {
    timeout: 5000, // Timeout in milliseconds (adjust as necessary)
    retries: 5, // Number of retries before failure
  });

const initializeMemcachedClient = async () => {
    if (memcachedClient) {
        return memcachedClient;
    }

    try {
        const memcachedEndpoint = process.env.MEMCACHED_ENDPOINT;
        memcachedClient = memjs.Client.create(memcachedEndpoint, {
            timeout: 1,   // Timeout after 1 second
            retries: 10,  // Retry 10 times on failure
        });

        console.log(`Connected to Memcached at ${memcachedEndpoint}`);
        return memcachedClient;
    } catch (err) {
        console.error('Error initializing Memcached client:', err);
        throw err;
    }
};

const cacheProgress = async (progressId, progressData) => {
    try {
        const client = await initializeMemcachedClient();
        const data = JSON.stringify(progressData);
        await client.set(progressId, data, { expires: 3600 });  // Cache for 1 hour
        console.log(`Progress for ${progressId} cached successfully.`);
    } catch (err) {
        console.error(`Error caching progress for ${progressId}:`, err);
    }
};

const getCachedProgress = async (progressId) => {
    try {
        const client = await initializeMemcachedClient();
        const result = await client.get(progressId);
        return result ? JSON.parse(result.value.toString()) : null;
    } catch (err) {
        console.error(`Error retrieving cached progress for ${progressId}:`, err);
        return null;
    }
};

const cacheFileMetadata = async (username, metadata) => {
    const key = `${username}_files`;
    try {
        const client = await initializeMemcachedClient();
        const data = JSON.stringify(metadata);
        await client.set(key, data, { expires: 3600 });  // Cache for 1 hour
        console.log(`File metadata for ${username} cached successfully.`);
    } catch (err) {
        console.error(`Error caching file metadata for ${username}:`, err);
    }
};

const getCachedFileMetadata = async (username) => {
    const key = `${username}_files`;
    try {
        const client = await initializeMemcachedClient();
        const result = await client.get(key);
        return result ? JSON.parse(result.value.toString()) : null;
    } catch (err) {
        console.error(`Error retrieving cached file metadata for ${username}:`, err);
        return null;
    }
};

module.exports = {
    cacheProgress,
    getCachedProgress,
    cacheFileMetadata,
    getCachedFileMetadata,
    initializeMemcachedClient,
};
