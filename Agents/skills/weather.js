import fetch from "node-fetch";

async function getCoordinates(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.results?.length) throw new Error(`City not found: "${city}"`);

  const { latitude, longitude, name, country } = data.results[0];
  return { latitude, longitude, name, country };
}

function describeWeatherCode(code) {
  const codes = {
    0: "Clear sky ☀️",
    1: "Mainly clear 🌤️",
    2: "Partly cloudy ⛅",
    3: "Overcast ☁️",
    45: "Foggy 🌫️",
    48: "Icy fog 🌫️",
    51: "Light drizzle 🌦️",
    53: "Moderate drizzle 🌦️",
    55: "Dense drizzle 🌧️",
    61: "Slight rain 🌧️",
    63: "Moderate rain 🌧️",
    65: "Heavy rain 🌧️",
    71: "Slight snow 🌨️",
    73: "Moderate snow 🌨️",
    75: "Heavy snow ❄️",
    77: "Snow grains ❄️",
    80: "Slight showers 🌦️",
    81: "Moderate showers 🌧️",
    82: "Violent showers ⛈️",
    85: "Snow showers 🌨️",
    86: "Heavy snow showers ❄️",
    95: "Thunderstorm ⛈️",
    96: "Thunderstorm with hail ⛈️",
    99: "Thunderstorm with heavy hail ⛈️",
  };
  return codes[code] ?? "Unknown";
}

function getWindDirection(degrees) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(degrees / 45) % 8];
}

// ✅ get real local time using city's timezone from API
function getLocalTime(timezone) {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const date = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return { time, date };
}

export async function getWeather(city) {
  if (!city || typeof city !== "string") return "Please provide a city name.";

  try {
    const { latitude, longitude, name, country } = await getCoordinates(city);

    const url = `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation,uv_index` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,sunrise,sunset` +
      `&timezone=auto` +   // ✅ auto returns timezone name
      `&forecast_days=3`;

    const res = await fetch(url);
    const data = await res.json();

    const c = data.current;
    const d = data.daily;

    // ✅ real local time using timezone from API response
    const { time, date } = getLocalTime(data.timezone);

    const current = [
      `🌍 **${name}, ${country}**`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🕐 Local Time    : ${time}`,
      `📅 Date          : ${date}`,
      `🌡️ Temperature   : ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)`,
      `🌤️ Condition     : ${describeWeatherCode(c.weather_code)}`,
      `💧 Humidity      : ${c.relative_humidity_2m}%`,
      `💨 Wind          : ${c.wind_speed_10m} km/h ${getWindDirection(c.wind_direction_10m)}`,
      `🌧️ Precipitation : ${c.precipitation} mm`,
      `☀️ UV Index      : ${c.uv_index}`,
      `🌐 Timezone      : ${data.timezone}`,
    ].join("\n");

    const forecast = d.time.map((day, i) => [
      `📅 ${day}`,
      `   ↑ ${d.temperature_2m_max[i]}°C  ↓ ${d.temperature_2m_min[i]}°C`,
      `   ${describeWeatherCode(d.weather_code[i])}`,
      `   🌧️ Rain: ${d.precipitation_sum[i]} mm`,
      `   🌅 Sunrise: ${d.sunrise[i].split("T")[1]}  🌇 Sunset: ${d.sunset[i].split("T")[1]}`,
    ].join("\n")).join("\n\n");

    return `${current}\n\n━━━━━━━━━━━━━━━━━━━━\n📆 3-DAY FORECAST\n━━━━━━━━━━━━━━━━━━━━\n${forecast}`;

  } catch (err) {
    console.error("[weather] error:", err.message);
    return `Could not get weather for "${city}": ${err.message}`;
  }
}

export default getWeather;