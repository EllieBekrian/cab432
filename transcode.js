const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { saveProgress, getProgress, updateProgress } = require("./db/database");
const redisClient = require("./redisClient");
const { getObjectFromS3, uploadToS3 } = require('./routes/s3_upload');

// Function to transcode video with progress tracking
const transcodeVideoWithProgress = async (fileName, progressId, username) => {
  return new Promise(async (resolve, reject) => {
    const tempDir = os.tmpdir();  // Create a temporary directory for file processing
    const inputPath = path.join(tempDir, fileName);  // Define input path for the video file

    // CPU usage logging interval
    const cpuLoggingInterval = setInterval(() => {
      logCpuUsage();
    }, 2000);

    try {
      // Download file from S3
      await downloadFileFromS3(fileName, username, inputPath);
      const outputFileName = `${path.parse(fileName).name}_transcoded.mp4`;  // Name the transcoded file
      const outputPath = path.join(tempDir, outputFileName);  // Define the output path for the transcoded file

      // Transcoding process
      ffmpeg(inputPath)
        .videoCodec("libx265")  // Use H.265 video codec
        .size("3840x2160")  // Set output resolution to 4K
        .audioBitrate("320k")  // Set audio bitrate
        .videoBitrate("8000k")  // Set video bitrate
        .addOption("-preset", "slow")  // Use 'slow' preset for better compression efficiency
        .addOption("-crf", "18")  // Constant rate factor for quality control
        .addOption('-threads', '0')  // Use all available CPU threads
        .on("progress", (progress) => {
          const percentage = Math.round(progress.percent);  // Calculate progress percentage
          console.log(`Processing: ${percentage}% done`);
          saveProgress(progressId, percentage, "transcoding");  // Save transcoding progress to the database
        })
        .on("end", async () => {
          console.log(`Finished transcoding: ${outputFileName}`);
          clearInterval(cpuLoggingInterval);  // Stop CPU logging when transcoding is done

          // Upload the transcoded file back to S3
          await uploadToS3(outputPath, username);

          // Clean up temporary files
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);

          resolve();  // Resolve the promise once the transcoding is complete
        })
        .on("error", (err) => {
          console.error("Error during transcoding:", err);
          clearInterval(cpuLoggingInterval);  // Stop CPU logging on error

          saveProgress(progressId, 0, "error");  // Save error progress state
          reject(err);  // Reject the promise with the error
        })
        .save(outputPath);  // Start transcoding and save to the output path
    } catch (err) {
      console.error("Error during transcoding process:", err);
      clearInterval(cpuLoggingInterval);  // Stop CPU logging on error
      saveProgress(progressId, 0, "error");  // Save error progress state
      reject(err);  // Reject the promise with the error
    }
  });
};

// Function to download a file from S3
const downloadFileFromS3 = async (fileName, username, downloadPath) => {
  try {
    const data = await getObjectFromS3(fileName, username);  // Fetch the object from S3

    // Validate if the response has a valid body
    if (!data || !data.Body) {
      throw new Error(`Failed to download file ${fileName} from S3: Body is undefined`);
    }

    // Log the size of the file to be downloaded for validation
    if (!data.ContentLength || data.ContentLength === 0) {
      throw new Error(`File ${fileName} from S3 is empty or has no content`);
    }

    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(downloadPath);  // Create a write stream for saving the file locally
      data.Body.pipe(writeStream).on("error", reject).on("close", resolve);  // Pipe the S3 object to the write stream
    });
  } catch (error) {
    console.error(`Error in downloadFileFromS3: ${error.message}`);
    throw error;  // Throw the error to be handled by the caller
  }
};

// Function to calculate start time for resuming transcoding from progress
function calculateStartTimeFromProgress(percent, duration) {
  return ((duration * percent) / 100).toFixed(2);  // Calculate the start time based on progress percentage
}

// Function to get video duration using ffmpeg's ffprobe
function getVideoDurationInSeconds(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error("Error getting video duration:", err);
        return reject(err);  // Reject the promise on error
      }
      const duration = metadata.format.duration;
      resolve(duration);  // Resolve with video duration in seconds
    });
  });
}

// Function to cache progress in Redis
const cacheProgress = async (progressId, progress) => {
  redisClient.setex(progressId, 3600, progress.toString());  // Cache progress for 1 hour
};

// Function to retrieve cached progress from Redis
const getCachedProgress = async (progressId) => {
  return new Promise((resolve, reject) => {
    redisClient.get(progressId, (err, progress) => {
      if (err) reject(err);  // Reject the promise on error
      resolve(progress ? { percentage: parseFloat(progress) } : null);  // Resolve with progress percentage if found
    });
  });
};

// Function to log CPU and memory usage
const logCpuUsage = () => {
  const cpus = os.cpus();
  let totalUsage = 0;

  cpus.forEach((cpu, i) => {
    const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
    const idle = cpu.times.idle;
    const usage = 100 - Math.round((idle / total) * 100);  // Calculate CPU usage percentage
    totalUsage += usage;
    console.log(`CPU ${i}: ${usage}% used`);
  });

  const averageUsage = (totalUsage / cpus.length).toFixed(2);
  const memoryUsage = process.memoryUsage();  // Get memory usage stats
  console.log(`Average CPU Usage: ${averageUsage}%`);
  console.log(
    `Memory Usage: RSS = ${(memoryUsage.rss / 1024 / 1024).toFixed(
      2
    )} MB, Heap Used = ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`
  );
};

// Export the transcoding function and CPU logging utility
module.exports = { transcodeVideoWithProgress, logCpuUsage };
