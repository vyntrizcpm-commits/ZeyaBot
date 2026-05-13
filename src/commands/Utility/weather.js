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
                `${WEATHER_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto`
            );

            const weatherData = await weatherResponse.json();

            const current = weatherData.current;

            const temperature = Math.round(current.temperature_2m);
            const feelsLike = Math.round(current.apparent_temperature);
            const humidity = current.relative_humidity_2m;
            const windSpeed = Math.round(current.wind_speed_10m);

            const weatherCode = current.weather_code;

            const weather = getWeatherDescription(weatherCode);

            const maxToday = Math.round(weatherData.daily.temperature_2m_max[0]);
            const minToday = Math.round(weatherData.daily.temperature_2m_min[0]);

            const embed = createEmbed({
                title: `${weather.emoji} ${temperature}°C • ${weather.name}`,
                description:
`### 📍 ${name}, ${country}

🌡️ **Feels Like:** ${feelsLike}°C
💨 **Wind Speed:** ${windSpeed} km/h
💧 **Humidity:** ${humidity}%

📈 **Today's Forecast**
🔺 Max: ${maxToday}°C
🔻 Min: ${minToday}°C`
            })

            .setColor(0xffffff)

            .setImage(weather.image)

            .setFooter({
                text: 'ZEYA Weather System'
            })

            .setTimestamp();

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed]
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
            image: "https://i.imgur.com/8OZ4Fhn.png"
        };
    }

    if (code >= 2 && code <= 3) {
        return {
            name: "Partly Cloudy",
            emoji: "⛅",
            image: "https://i.imgur.com/vgLHf7x.png"
        };
    }

    if (code >= 45 && code <= 48) {
        return {
            name: "Foggy",
            emoji: "🌫️",
            image: "https://i.imgur.com/5TRQpPj.png"
        };
    }

    if (code >= 51 && code <= 67) {
        return {
            name: "Rainy",
            emoji: "🌧️",
            image: "https://i.imgur.com/SqgoF8T.png"
        };
    }

    if (code >= 71 && code <= 86) {
        return {
            name: "Snowy",
            emoji: "❄️",
            image: "https://i.imgur.com/y8T8s8M.png"
        };
    }

    if (code >= 95 && code <= 99) {
        return {
            name: "Thunderstorm",
            emoji: "⛈️",
            image: "https://i.imgur.com/VYq6X9B.png"
        };
    }

    return {
        name: "Unknown Weather",
        emoji: "🌍",
        image: "https://i.imgur.com/vgLHf7x.png"
    };
}
