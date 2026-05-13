import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

export default {
    data: new SlashCommandBuilder()
        .setName("weather")
        .setDescription("Get real-time weather information")
        .addStringOption((option) =>
            option
                .setName("city")
                .setDescription("Enter a city")
                .setRequired(true),
        ),

    async execute(interaction) {

        try {

            const deferSuccess = await InteractionHelper.safeDefer(interaction);

            if (!deferSuccess) return;

            const city = interaction.options.getString("city");

            const geoResponse = await fetch(
                `${GEOCODING_URL}?name=${encodeURIComponent(city)}`
            );

            const geoData = await geoResponse.json();

            if (!geoData.results || geoData.results.length === 0) {

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "City Not Found",
                            `Could not find **${city}**.`
                        )
                    ]
                });
            }

            const { latitude, longitude, name, country } = geoData.results[0];

            const weatherResponse = await fetch(
                `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`
            );

            const weatherData = await weatherResponse.json();

            if (weatherData.error) {

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Weather Error",
                            "Failed to fetch weather data."
                        )
                    ]
                });
            }

            const current = weatherData.current;

            const temperature = Math.round(current.temperature_2m);
            const feelsLike = Math.round(current.apparent_temperature);
            const humidity = current.relative_humidity_2m;
            const windSpeed = Math.round(current.wind_speed_10m);

            const weatherCode = current.weather_code;

            const weather = getWeatherDescription(weatherCode);

            const embed = createEmbed({
    title: `${weather.emoji} ${temperature}°C / ${Math.round((temperature * 9/5) + 32)}°F • ${weather.name}`,
    description:
`📍 **${name}, ${country}**

🌡️ **Feels Like:** ${feelsLike}°C / ${Math.round((feelsLike * 9/5) + 32)}°F
💨 **Wind Speed:** ${windSpeed} km/h
💧 **Humidity:** ${humidity}%

📅 **3-Day Forecast**

**Today**
🌡️ High: ${Math.round(weatherData.daily.temperature_2m_max[0])}°C / ${Math.round((weatherData.daily.temperature_2m_max[0] * 9/5) + 32)}°F
❄️ Low: ${Math.round(weatherData.daily.temperature_2m_min[0])}°C / ${Math.round((weatherData.daily.temperature_2m_min[0] * 9/5) + 32)}°F

**Tomorrow**
🌡️ High: ${Math.round(weatherData.daily.temperature_2m_max[1])}°C / ${Math.round((weatherData.daily.temperature_2m_max[1] * 9/5) + 32)}°F
❄️ Low: ${Math.round(weatherData.daily.temperature_2m_min[1])}°C / ${Math.round((weatherData.daily.temperature_2m_min[1] * 9/5) + 32)}°F

**Day After**
🌡️ High: ${Math.round(weatherData.daily.temperature_2m_max[2])}°C / ${Math.round((weatherData.daily.temperature_2m_max[2] * 9/5) + 32)}°F
❄️ Low: ${Math.round(weatherData.daily.temperature_2m_min[2])}°C / ${Math.round((weatherData.daily.temperature_2m_min[2] * 9/5) + 32)}°F`
})
            .setColor(0xffffff)

            .setImage(weather.image)

            .setFooter({
                text: 'Zeya! Weather System'
            })

            .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
            });

            logger.info(`Weather command executed`, {
                city: name,
                country: country,
                userId: interaction.user.id
            });

        } catch (error) {

            logger.error(`Weather command execution failed`, {
                error: error.message,
                stack: error.stack
            });

            await handleInteractionError(interaction, error, {
                commandName: 'weather',
                source: 'weather_command'
            });
        }
    },
};

function getWeatherDescription(code) {

    if (code >= 0 && code <= 1) {
        return {
            name: "Clear Sky",
            emoji: "☀️",
            image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb"
        };
    }

    if (code >= 2 && code <= 3) {
        return {
            name: "Partly Cloudy",
            emoji: "⛅",
            image: "https://images.unsplash.com/photo-1499346030926-9a72daac6c63"
        };
    }

    if (code >= 45 && code <= 48) {
        return {
            name: "Foggy",
            emoji: "🌫️",
            image: "https://images.unsplash.com/photo-1485236715568-ddc5ee6ca227"
        };
    }

    if (code >= 51 && code <= 67) {
        return {
            name: "Rainy",
            emoji: "🌧️",
            image: "https://images.unsplash.com/photo-1515694346937-94d85e41e6f0"
        };
    }

    if (code >= 71 && code <= 86) {
        return {
            name: "Snowy",
            emoji: "❄️",
            image: "https://images.unsplash.com/photo-1483664852095-d6cc6870702d"
        };
    }

    if (code >= 95 && code <= 99) {
        return {
            name: "Thunderstorm",
            emoji: "⛈️",
            image: "https://images.unsplash.com/photo-1500674425229-f692875b0ab7"
        };
    }

    return {
        name: "Unknown Weather",
        emoji: "🌍",
        image: "https://images.unsplash.com/photo-1499346030926-9a72daac6c63"
    };
}
