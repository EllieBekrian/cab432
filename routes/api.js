const express = require('express');
const router = express.Router();
const { authenticateToken, authorizeAdmin } = require('../auth.js');
const rateLimit = require('express-rate-limit');
const {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { loadConfig } = require('../config.js');
const {
  getAllUsers,
  getFileMetadata,
  getProgress,
  deleteFile,
  getAllFiles,
} = require('../db/database.js');
const {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  deleteFileFromS3,
} = require('./s3_upload');
const { getWeatherData } = require('./weather.js');

// Limit login attempts to prevent brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many attempts from this IP, please try again after 15 minutes.',
  headers: true,
});

// Login Route
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    const config = await loadConfig();
    const cognitoClient = new CognitoIdentityProviderClient({
      region: config.awsRegion, // credentials via IAM Role on EC2
    });

    const params = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.cognitoClientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    };

    const command = new InitiateAuthCommand(params);
    const response = await cognitoClient.send(command);
    const token = response.AuthenticationResult.AccessToken;

    res.cookie('token', token, { httpOnly: true, sameSite: 'Lax', path: '/' });
    res.cookie('username', username, { httpOnly: false, sameSite: 'Lax', path: '/' });

    res.json({ authToken: token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(403).json({ error: 'Invalid login credentials' });
  }
});

// Registration Route
router.post('/register', loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    const config = await loadConfig();
    const cognitoClient = new CognitoIdentityProviderClient({
      region: config.awsRegion, // credentials via IAM Role on EC2
    });

    const params = {
      ClientId: config.cognitoClientId,
      Username: username,
      Password: password,
      UserAttributes: [
        {
          Name: 'email',
          Value: username,
        },
      ],
    };

    const command = new SignUpCommand(params);
    await cognitoClient.send(command);

    res.json({
      message: 'Registration successful. Please check your email for the confirmation code.',
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

// Confirm Sign-Up Route
router.post('/confirm', async (req, res) => {
  const { username, confirmationCode } = req.body;

  try {
    const config = await loadConfig();
    const cognitoClient = new CognitoIdentityProviderClient({
      region: config.awsRegion, // credentials via IAM Role on EC2
    });

    const params = {
      ClientId: config.cognitoClientId,
      Username: username,
      ConfirmationCode: confirmationCode,
    };

    const command = new ConfirmSignUpCommand(params);
    await cognitoClient.send(command);

    res.status(200).json({ message: 'Verification successful. You can now log in.' });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(400).json({ error: 'Verification failed. Please try again.' });
  }
});

// Admin: Fetch All Files
router.get('/admin/files', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const files = await getAllFiles();
    res.status(200).json({ message: 'All files fetched successfully.', files });
  } catch (error) {
    console.error('Error fetching all files:', error);
    res.status(500).json({ error: 'An internal error occurred while fetching files.' });
  }
});

// Admin: Delete File
router.post('/admin/delete-file', authenticateToken, authorizeAdmin, async (req, res) => {
  const { username, fileName } = req.body;

  if (!username || !fileName) {
    return res.status(400).json({ error: 'Username and file name are required.' });
  }

  try {
    await deleteFileFromS3(fileName, username);
    await deleteFile(username, fileName);
    res.status(200).json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'An internal error occurred while deleting the file.' });
  }
});

// Admin: Fetch All Users
router.get('/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const users = await getAllUsers();
    res.status(200).json({ message: 'Users fetched successfully.', users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'An internal error occurred while fetching users.' });
  }
});

// Fetch files for a specific user with progress
router.get('/files', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    const files = await getFileMetadata(username);
    console.log('Files retrieved from database: ', files); // Debugging

    if (!files.length) {
      return res.status(200).json({ message: 'No files found for the user.' });
    }

    const filesWithProgress = await Promise.all(
      files.map(async (file) => {
        const progressData = await getProgress(username, file.fileName);
        const progress = progressData ? parseFloat(progressData.progress) : 100;
        return { ...file, progress };
      })
    );

    console.log('Files with progress data: ', filesWithProgress); // Debugging

    res.status(200).json({
      message: 'Files metadata and progress listed successfully.',
      files: filesWithProgress,
      links: { upload: '/api/v1/upload' },
    });
  } catch (error) {
    console.error('Error fetching file metadata:', error);
    res.status(500).json({ error: 'An internal error occurred while fetching files metadata.' });
  }
});

// Generate presigned URL for uploading files to S3
router.get('/upload-url', authenticateToken, async (req, res) => {
  const { fileName } = req.query;
  const username = req.user.username;

  if (!fileName) {
    return res.status(400).json({ error: 'File name is required.' });
  }

  try {
    const presignedUrl = await generatePresignedUploadUrl(fileName, username);
    res.status(200).json({ url: presignedUrl });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL.' });
  }
});

// Generate presigned URL for downloading files from S3
router.get('/download-url', authenticateToken, async (req, res) => {
  const { fileName } = req.query;
  const username = req.user.username;

  if (!fileName) {
    return res.status(400).json({ error: 'File name is required.' });
  }

  try {
    const presignedUrl = await generatePresignedDownloadUrl(fileName, username);
    res.status(200).json({ url: presignedUrl });
  } catch (error) {
    console.error('Error generating download URL:', error);
    res.status(500).json({ error: 'Failed to generate download URL.' });
  }
});

// Fetch progress of transcoding for a file
router.get('/progress/:progressId', authenticateToken, async (req, res) => {
  // progressId در عمل نام فایل است
  const fileName = req.params.progressId;
  const username = req.user.username;

  try {
    const progressData = await getProgress(username, fileName);

    if (!progressData) {
      return res.status(404).json({ error: 'Progress not found.' });
    }

    res.status(200).json({
      progress: parseFloat(progressData.progress) || 0,
      status: progressData.status || 'unknown',
    });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress.' });
  }
});

// Example: weather proxy
router.get('/weather', async (req, res) => {
  const city = req.query.city || 'Brisbane';
  try {
    const weatherInfo = await getWeatherData(city);
    res.status(200).json(weatherInfo);
  } catch (error) {
    console.error('Error in /weather route:', error.message);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

module.exports = router;
