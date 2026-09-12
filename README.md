# WeatherDash — Weather Dashboard

A lightweight, fully responsive Weather Dashboard web application built with vanilla JavaScript, HTML5, and CSS3. It delivers real-time weather information, key meteorological indicators, and a 5-day forecast using the OpenWeatherMap API.

---

## Features

* **Real-Time Weather Metrics:** Displays temperature, humidity, wind speed, atmospheric pressure, and visibility[cite: 1, 2].
* **5-Day Forecast:** Provides daily high/low temperatures and weather conditions for upcoming days[cite: 1, 2].
* **Dynamic Weather Themes:** Automatically switches UI theme palettes (sunny, rainy, stormy, snowy, cloudy, night, foggy) based on OpenWeatherMap weather condition IDs and local sun positioning[cite: 1, 3].
* **Geolocation Support:** Fetches instant weather for your current position using the browser Geolocation API[cite: 1, 2].
* **Search Persistence:** Remembers the last searched location using `localStorage` for quick re-entry.
* **Responsive Glassmorphism UI:** Adapted layout across desktop, tablet, and mobile breakpoints[cite: 3].

---

## Tech Stack

* **Frontend:** HTML5, CSS3 (Custom Properties, Flexbox, Grid), Vanilla JavaScript (ES6+)[cite: 1, 2, 3]
* **Icons & Fonts:** Font Awesome 6, Google Fonts (Inter)[cite: 2]
* **API:** OpenWeatherMap API (`/weather` and `/forecast` endpoints)

---

## Project Structure

```text
├── index.html     # Application structure and DOM elements
├── style.css      # Custom styling, themes, grid system, and media queries
└── app.js         # State management, API calls, dynamic UI rendering, and theme logic
