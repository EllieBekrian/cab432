const express = require('express');
const router = express.Router();
const auth = require('../auth.js');
const {
  saveUserActivity,
  saveFileMetadata,
  saveProgress,
  getFileMetadata,
} = require('../db/database.js');
const { transcodeVideoWithProgress } = require('../transcode');

// Handle upload notification and kick off processing
router.post('/', auth.authenticateToken, async (req, res) => {
  const { fileName } = req.body;
  const username = req.user.username;

  if (!fileName) {
    return res.status(400).json({ error: 'File name is required.' });
  }

  // progressId را با طراحی فعلی برابر با نام فایل می‌گیریم
  const progressId = fileName;

  try {
    // Log user activity
    await saveUserActivity(username, `Started processing file: ${fileName}`);

    const fileMetadata = {
      fileName,
      size: null, // اگر بعداً اندازه را داشته باشیم، مقداردهی می‌شود
      uploadTime: new Date().toISOString(),
      user: username,
      progressId,
      status: 'uploaded',
    };

    // Save metadata + initial progress
    await saveFileMetadata(fileMetadata);
    await saveProgress(username, fileName, { progress: 0, status: 'started' });

    // Start transcoding and update progress
    transcodeVideoWithProgress(fileName, progressId, username)
      .then(async () => {
        await saveProgress(username, fileName, { progress: 100, status: 'completed' });
        await saveUserActivity(username, `Transcoding completed for file: ${fileName}`);
        console.log(`Transcoding completed for ${fileName}`);
      })
      .catch(async (err) => {
        console.error(`Transcoding failed for ${fileName}:`, err);
        await saveProgress(username, fileName, { progress: 0, status: 'error' });
        await saveUserActivity(username, `Transcoding failed for file: ${fileName}`);
      });

    res.status(201).json({
      message: 'File metadata saved. Transcoding has started.',
      fileName,
      progressId,
    });
  } catch (err) {
    console.error('Error handling upload:', err);
    res.status(500).json({ error: 'Failed to handle upload.' });
  }
});

// List uploaded files and their metadata for the authenticated user
router.get('/files', auth.authenticateToken, async (req, res) => {
  const username = req.user.username;

  try {
    const files = await getFileMetadata(username);
    console.log('Files retrieved for user:', username, files);

    if (!files || files.length === 0) {
      return res.status(200).json({
        message: 'No files uploaded yet.',
        files: [],
      });
    }

    res.status(200).json({
      message: 'Files fetched successfully.',
      files,
    });
  } catch (err) {
    console.error('Error fetching files:', err);
    res.status(500).json({
      error: 'An internal error occurred while fetching files.',
    });
  }
});

module.exports = router;
