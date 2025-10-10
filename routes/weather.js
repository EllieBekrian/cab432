// routes/weather.js
const express = require("express");
const axios = require("axios");
const memjs = require("memjs");

const router = express.Router();

// اتصال به ElastiCache (Memcached)
const mc = memjs.Client.create(process.env.MEMCACHED_ENDPOINT || "localhost:11211");

router.get("/", async (req, res) => {
  const city = req.query.city || "Brisbane";
  const cacheKey = `weather_${city.toLowerCase()}`;

  try {
    // بررسی در cache
    const cached = await mc.get(cacheKey);
    if (cached.value) {
      console.log(`✅ Cache hit for ${city}`);
      return res.json(JSON.parse(cached.value.toString()));
    }

    // در صورت نبود cache، دریافت از API
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) throw new Error("OpenWeather API key is not set.");

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    const response = await axios.get(apiUrl);

    // ذخیره در cache به مدت 5 دقیقه (300 ثانیه)
    await mc.set(cacheKey, JSON.stringify(response.data), { expires: 300 });

    console.log(`🌤️ Fetched and cached weather for ${city}`);
    res.json(response.data);

  } catch (err) {
    console.error("Error in /weather:", err.message);
    res.status(500).json({ error: "Failed to fetch weather data." });
  }
});

module.exports = { getWeatherData: router };
