/**
 * ============================================================
 * WeatherDash — app.js
 * ============================================================
 * Architecture
 * ────────────
 *  ┌─────────────────────────────────┐
 *  │  CONFIG         constants / API │
 *  ├─────────────────────────────────┤
 *  │  STATE          single source   │
 *  ├─────────────────────────────────┤
 *  │  API SERVICE    fetch wrappers  │
 *  ├─────────────────────────────────┤
 *  │  THEME ENGINE   dynamic themes  │
 *  ├─────────────────────────────────┤
 *  │  DOM RENDERER   pure UI writes  │
 *  ├─────────────────────────────────┤
 *  │  TOAST          notifications   │
 *  ├─────────────────────────────────┤
 *  │  CONTROLLER     orchestration   │
 *  └─────────────────────────────────┘
 *
 * Usage
 * ─────
 *  1. Replace API_KEY below with your free OpenWeatherMap key.
 *     Get one at: https://home.openweathermap.org/users/sign_up
 *  2. Open index.html in a browser (ideally via a local server
 *     so the Geolocation API works over a secure context).
 * ============================================================
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONFIG
───────────────────────────────────────────────────────────── */
const CONFIG = {
  /** ⚠ Replace with your own key from openweathermap.org */
  API_KEY: '42fbc8cd55b1177d2d45fb235a456f5c',

  BASE_URL: 'https://api.openweathermap.org/data/2.5',

  /** Units: 'metric' (°C) | 'imperial' (°F) | 'standard' (K) */
  UNITS: 'metric',

  /** LocalStorage key for persisting the last searched city */
  STORAGE_KEY: 'weatherdash_last_city',

  /** How long toast messages stay visible (ms) */
  TOAST_DURATION: 4000,

  /** Forecast days to show (max 5 for free tier) */
  FORECAST_DAYS: 5,
};


/* ─────────────────────────────────────────────────────────────
   STATE
   Single source of truth — never mutate directly, use setState()
───────────────────────────────────────────────────────────── */
const state = {
  /** Currently displayed city name */
  city: null,

  /** Raw API response objects */
  currentData: null,
  forecastData: null,

  /** Loading / error flags */
  isLoading: false,
  error: null,
};

/**
 * Merges a partial update into state and triggers a re-render.
 * @param {Partial<typeof state>} patch
 */
function setState(patch) {
  Object.assign(state, patch);
  render();
}


/* ─────────────────────────────────────────────────────────────
   API SERVICE
   All network logic lives here. No DOM touches.
───────────────────────────────────────────────────────────── */

/**
 * Builds a full OpenWeatherMap endpoint URL.
 * @param {string} endpoint  e.g. '/weather'
 * @param {Record<string,string>} params  extra query params
 * @returns {string}
 */
function buildUrl(endpoint, params = {}) {
  const url = new URL(`${CONFIG.BASE_URL}${endpoint}`);
  url.searchParams.set('appid', CONFIG.API_KEY);
  url.searchParams.set('units', CONFIG.UNITS);
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }
  return url.toString();
}

/**
 * Generic fetch wrapper with error normalisation.
 * Throws a descriptive Error on non-2xx or network failure.
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function apiFetch(url) {
  const response = await fetch(url);

  if (!response.ok) {
    // Parse the OpenWeatherMap error body when available
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.message ?? message;
    } catch {
      // response body wasn't JSON; keep the status message
    }

    // Map common status codes to friendly messages
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your OpenWeatherMap key in app.js.');
    }
    if (response.status === 404) {
      throw new Error(`City not found. Please check the spelling and try again.`);
    }
    if (response.status === 429) {
      throw new Error('Too many requests. Please wait a moment and try again.');
    }
    throw new Error(`Weather service error: ${message}`);
  }

  return response.json();
}

/**
 * Fetches current weather data by city name.
 * @param {string} city
 * @returns {Promise<Object>}  OpenWeatherMap /weather response
 */
async function fetchCurrentWeather(city) {
  const url = buildUrl('/weather', { q: city });
  return apiFetch(url);
}

/**
 * Fetches current weather by geographic coordinates.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Object>}
 */
async function fetchCurrentWeatherByCoords(lat, lon) {
  const url = buildUrl('/weather', { lat: String(lat), lon: String(lon) });
  return apiFetch(url);
}

/**
 * Fetches 5-day / 3-hour forecast by city name.
 * @param {string} city
 * @returns {Promise<Object>}  OpenWeatherMap /forecast response
 */
async function fetchForecast(city) {
  const url = buildUrl('/forecast', { q: city, cnt: '40' });
  return apiFetch(url);
}

/**
 * Fetches 5-day forecast by geographic coordinates.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Object>}
 */
async function fetchForecastByCoords(lat, lon) {
  const url = buildUrl('/forecast', {
    lat: String(lat),
    lon: String(lon),
    cnt: '40',
  });
  return apiFetch(url);
}


/* ─────────────────────────────────────────────────────────────
   THEME ENGINE
   Maps OWM weather condition IDs → CSS data-theme values
───────────────────────────────────────────────────────────── */

/**
 * Determines the visual theme from an OWM condition ID and local time.
 *
 * OWM condition ID ranges:
 *   2xx → Thunderstorm
 *   3xx → Drizzle
 *   5xx → Rain
 *   6xx → Snow
 *   7xx → Atmosphere (mist, fog, haze…)
 *   800 → Clear sky
 *   80x → Clouds
 *
 * @param {number} conditionId  OWM weather condition code
 *    @see https://openweathermap.org/weather-conditions
 * @param {number} sunrise      Unix timestamp (seconds)
 * @param {number} sunset       Unix timestamp (seconds)
 * @returns {'default'|'sunny'|'cloudy'|'rainy'|'stormy'|'snowy'|'night'|'foggy'}
 */
function resolveTheme(conditionId, sunrise, sunset) {
  const nowSec = Date.now() / 1000;
  const isNight = nowSec < sunrise || nowSec > sunset;

  // Night overrides everything except storm/snow for dramatic effect
  if (isNight && conditionId === 800) return 'night';

  if (conditionId >= 200 && conditionId < 300) return 'stormy';   // Thunderstorm
  if (conditionId >= 300 && conditionId < 400) return 'rainy';    // Drizzle
  if (conditionId >= 500 && conditionId < 600) return 'rainy';    // Rain
  if (conditionId >= 600 && conditionId < 700) return 'snowy';    // Snow
  if (conditionId >= 700 && conditionId < 800) return 'foggy';    // Atmosphere
  if (conditionId === 800) return 'sunny';                         // Clear sky
  if (conditionId >= 801 && conditionId <= 802) return 'cloudy';  // Few/scattered clouds
  if (conditionId >= 803) return 'cloudy';                         // Broken/overcast

  return isNight ? 'night' : 'default';
}

/**
 * Applies the chosen theme to <body> and <html> data-theme attributes.
 * @param {string} theme
 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  // Also keep a class for any class-based CSS hooks
  document.body.className = `theme-${theme}`;
}


/* ─────────────────────────────────────────────────────────────
   HELPERS / FORMATTERS
───────────────────────────────────────────────────────────── */

/**
 * Returns a human-readable weekday name from a Unix timestamp.
 * @param {number} unixSec  Unix timestamp in seconds
 * @returns {string}  e.g. "Monday"
 */
function formatDay(unixSec) {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    weekday: 'long',
  });
}

/**
 * Short weekday name, e.g. "Mon".
 * @param {number} unixSec
 */
function formatDayShort(unixSec) {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    weekday: 'short',
  });
}

/**
 * Full date string, e.g. "Thursday, September 10, 2026".
 * @param {number} unixSec
 */
function formatDate(unixSec) {
  return new Date(unixSec * 1000).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Rounds a float temperature to the nearest integer.
 * @param {number} temp
 * @returns {string}  e.g. "23"
 */
function formatTemp(temp) {
  return Math.round(temp).toString();
}

/**
 * Builds the URL for an OWM weather icon.
 * @param {string} iconCode  e.g. "10d"
 * @param {'2x'|'4x'} [size='4x']
 * @returns {string}
 */
function iconUrl(iconCode, size = '4x') {
  return `https://openweathermap.org/img/wn/${iconCode}@${size}.png`;
}

/**
 * Maps an OWM icon code to a weather emoji for reliable rendering.
 * Used as a fallback / primary display when PNG icons look poor.
 * @param {string} iconCode  e.g. "01d", "10n"
 * @returns {string}  emoji character
 */
function iconEmoji(iconCode) {
  const map = {
    '01d': '☀️',  // clear sky day
    '01n': '🌙',  // clear sky night
    '02d': '⛅',  // few clouds day
    '02n': '☁️',  // few clouds night
    '03d': '☁️',  // scattered clouds
    '03n': '☁️',
    '04d': '☁️',  // broken clouds
    '04n': '☁️',
    '09d': '🌧️',  // shower rain
    '09n': '🌧️',
    '10d': '🌦️',  // rain day
    '10n': '🌧️',  // rain night
    '11d': '⛈️',  // thunderstorm
    '11n': '⛈️',
    '13d': '❄️',  // snow
    '13n': '❄️',
    '50d': '🌫️',  // mist
    '50n': '🌫️',
  };
  return map[iconCode] ?? '🌡️';
}

/**
 * Converts metres/second to km/h, rounded.
 * @param {number} mps
 * @returns {string}
 */
function mpsToKph(mps) {
  return Math.round(mps * 3.6).toString();
}

/**
 * Reduces the raw OWM 3-hour forecast list to one entry per day
 * (the noon reading, or closest available), capped to FORECAST_DAYS.
 *
 * @param {Array<Object>} list  OWM /forecast list array
 * @returns {Array<Object>}
 */
function groupForecastByDay(list) {
  const seen = new Set();
  const days = [];

  for (const item of list) {
    const date = new Date(item.dt * 1000);
    const dayKey = date.toDateString();

    // Skip today — we already show it in the "current weather" card
    const todayKey = new Date().toDateString();
    if (dayKey === todayKey) continue;

    if (!seen.has(dayKey)) {
      seen.add(dayKey);
      days.push(item);
      if (days.length === CONFIG.FORECAST_DAYS) break;
    }
  }

  return days;
}


/* ─────────────────────────────────────────────────────────────
   DOM RENDERER
   Pure DOM writes — no fetches, no side-effects beyond the DOM.
───────────────────────────────────────────────────────────── */

/** Cache commonly accessed DOM nodes */
const DOM = {
  loading:        document.getElementById('loading'),
  welcome:        document.getElementById('welcome'),
  currentWeather: document.getElementById('current-weather'),
  forecast:       document.getElementById('forecast'),
  forecastGrid:   document.getElementById('forecast-grid'),

  // Current weather fields
  city:        document.getElementById('cw-city'),
  date:        document.getElementById('cw-date'),
  icon:        document.getElementById('cw-icon'),
  temp:        document.getElementById('cw-temp'),
  description: document.getElementById('cw-description'),
  feels:       document.getElementById('cw-feels'),
  humidity:    document.getElementById('cw-humidity'),
  wind:        document.getElementById('cw-wind'),
  pressure:    document.getElementById('cw-pressure'),
  visibility:  document.getElementById('cw-visibility'),
  uv:          document.getElementById('cw-uv'),
};

/**
 * Master render function — reads state and updates every DOM node.
 * Called automatically by setState().
 */
function render() {
  if (state.isLoading) {
    showSection('loading');
    return;
  }

  if (state.error || !state.currentData) {
    showSection('welcome');
    return;
  }

  renderCurrentWeather(state.currentData);
  renderForecast(state.forecastData);
  showSection('weather');
}

/**
 * Toggles which major section is visible.
 * @param {'loading'|'welcome'|'weather'} section
 */
function showSection(section) {
  DOM.loading.hidden        = section !== 'loading';
  DOM.welcome.hidden        = section !== 'welcome';
  DOM.currentWeather.hidden = section !== 'weather';
  DOM.forecast.hidden       = section !== 'weather';
}

/**
 * Populates the current-weather card from an OWM /weather response.
 * @param {Object} data  Raw OWM current weather object
 */
function renderCurrentWeather(data) {
  const { name, sys, weather, main, wind, visibility } = data;
  const condition = weather[0];

  // Location & date
  DOM.city.textContent = `${name}, ${sys.country}`;
  DOM.date.textContent = formatDate(data.dt);

  // Icon
  DOM.icon.textContent = iconEmoji(condition.icon);
  DOM.icon.setAttribute('aria-label', condition.description);

  // Temperature
  DOM.temp.textContent        = formatTemp(main.temp);
  DOM.description.textContent = condition.description;

  // Detail chips
  DOM.feels.textContent    = `${formatTemp(main.feels_like)} °C`;
  DOM.humidity.textContent = `${main.humidity} %`;
  DOM.wind.textContent     = `${mpsToKph(wind.speed)} km/h`;
  DOM.pressure.textContent = `${main.pressure} hPa`;
  DOM.visibility.textContent = visibility
    ? `${(visibility / 1000).toFixed(1)} km`
    : 'N/A';

  // Theme
  const theme = resolveTheme(condition.id, sys.sunrise, sys.sunset);
  applyTheme(theme);
}

/**
 * Builds and inserts the 5-day forecast grid from an OWM /forecast response.
 * @param {Object} data  Raw OWM forecast object (or null)
 */
function renderForecast(data) {
  if (!data) return;

  const days = groupForecastByDay(data.list);
  DOM.forecastGrid.innerHTML = '';

  days.forEach((item, index) => {
    const condition = item.weather[0];
    const card = document.createElement('div');
    card.className = 'forecast-day';
    card.setAttribute('role', 'listitem');
    // Stagger animation
    card.style.animationDelay = `${index * 80}ms`;

    card.innerHTML = `
      <p class="forecast-day__name">${formatDayShort(item.dt)}</p>
      <div
        class="forecast-day__icon"
        aria-label="${condition.description}"
        role="img"
      >${iconEmoji(condition.icon)}</div>
      <p class="forecast-day__desc">${condition.description}</p>
      <div class="forecast-day__temps" aria-label="High and low temperature">
        <span class="forecast-day__high" title="High">
          ${formatTemp(item.main.temp_max)}°
        </span>
        <span class="forecast-day__low" title="Low">
          ${formatTemp(item.main.temp_min)}°
        </span>
      </div>
    `;

    DOM.forecastGrid.appendChild(card);
  });
}


/* ─────────────────────────────────────────────────────────────
   TOAST NOTIFICATION SYSTEM
───────────────────────────────────────────────────────────── */
const toastEl  = document.getElementById('toast');
const toastMsg = document.getElementById('toast-message');
const toastIcon = toastEl.querySelector('.toast__icon');
let toastTimer = null;

/**
 * Shows a toast notification.
 * @param {string}  message
 * @param {'error'|'success'} [type='error']
 */
function showToast(message, type = 'error') {
  clearTimeout(toastTimer);

  toastMsg.textContent = message;

  // Update icon based on type
  toastIcon.className = type === 'success'
    ? 'toast__icon fa-solid fa-circle-check'
    : 'toast__icon fa-solid fa-circle-exclamation';

  // Toggle colour class
  toastEl.classList.toggle('toast--success', type === 'success');
  toastEl.classList.add('toast--visible');

  toastTimer = setTimeout(hideToast, CONFIG.TOAST_DURATION);
}

/** Hides the active toast. */
function hideToast() {
  toastEl.classList.remove('toast--visible');
}


/* ─────────────────────────────────────────────────────────────
   PERSISTENCE (LocalStorage)
───────────────────────────────────────────────────────────── */

/**
 * Saves a city name to LocalStorage.
 * @param {string} city
 */
function saveLastCity(city) {
  try {
    localStorage.setItem(CONFIG.STORAGE_KEY, city);
  } catch {
    // Private browsing or quota exceeded — silently ignore
  }
}

/**
 * Retrieves the last searched city from LocalStorage.
 * @returns {string|null}
 */
function loadLastCity() {
  try {
    return localStorage.getItem(CONFIG.STORAGE_KEY);
  } catch {
    return null;
  }
}


/* ─────────────────────────────────────────────────────────────
   CONTROLLER
   Orchestrates: fetch → state update → render
───────────────────────────────────────────────────────────── */

/**
 * Master function that loads weather for a named city.
 * Handles loading state, error handling, and persistence.
 *
 * @param {string} city
 */
async function loadWeatherForCity(city) {
  const trimmed = city.trim();
  if (!trimmed) {
    showToast('Please enter a city name.');
    return;
  }

  // Validate API key before making a real request
  if (CONFIG.API_KEY === 'YOUR_API_KEY_HERE') {
    showToast(
      'No API key set. Edit app.js and replace YOUR_API_KEY_HERE with your OpenWeatherMap key.'
    );
    return;
  }

  setState({ isLoading: true, error: null });

  try {
    // Fire both requests in parallel for speed
    const [currentData, forecastData] = await Promise.all([
      fetchCurrentWeather(trimmed),
      fetchForecast(trimmed),
    ]);

    saveLastCity(trimmed);

    setState({
      isLoading: false,
      city: trimmed,
      currentData,
      forecastData,
      error: null,
    });
  } catch (err) {
    console.error('[WeatherDash] Fetch error:', err);
    setState({
      isLoading: false,
      currentData: null,
      forecastData: null,
      error: err.message,
    });
    showToast(err.message);
  }
}

/**
 * Loads weather using the browser Geolocation API.
 * Falls back to a toast message if permission is denied or unavailable.
 */
async function loadWeatherByGeolocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.');
    return;
  }

  // Validate API key
  if (CONFIG.API_KEY === 'YOUR_API_KEY_HERE') {
    showToast(
      'No API key set. Edit app.js and replace YOUR_API_KEY_HERE with your OpenWeatherMap key.'
    );
    return;
  }

  setState({ isLoading: true, error: null });

  /** Wraps getCurrentPosition in a Promise */
  const getPosition = () =>
    new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 10_000,        // 10 s
        maximumAge: 60_000,     // accept a 60 s cached position
        enableHighAccuracy: false,
      });
    });

  try {
    const { coords } = await getPosition();
    const { latitude: lat, longitude: lon } = coords;

    const [currentData, forecastData] = await Promise.all([
      fetchCurrentWeatherByCoords(lat, lon),
      fetchForecastByCoords(lat, lon),
    ]);

    // Save city name derived from the API response
    saveLastCity(currentData.name);

    // Also update the search input so the user can see the resolved name
    document.getElementById('search-input').value = currentData.name;

    setState({
      isLoading: false,
      city: currentData.name,
      currentData,
      forecastData,
      error: null,
    });
  } catch (err) {
    console.error('[WeatherDash] Geolocation error:', err);

    let message = 'Could not retrieve your location.';
    if (err instanceof GeolocationPositionError) {
      if (err.code === err.PERMISSION_DENIED) {
        message = 'Location access denied. Please allow location permissions and try again.';
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        message = 'Your location is currently unavailable.';
      } else if (err.code === err.TIMEOUT) {
        message = 'Location request timed out. Please try again.';
      }
    } else {
      message = err.message;
    }

    setState({
      isLoading: false,
      currentData: null,
      forecastData: null,
      error: message,
    });
    showToast(message);
  }
}


/* ─────────────────────────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────────────────────────── */

/** Search form submission */
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const city = document.getElementById('search-input').value;
  loadWeatherForCity(city);
});

/** "Use my location" button */
document.getElementById('geo-btn').addEventListener('click', () => {
  loadWeatherByGeolocation();
});

/** Dismiss toast on click */
toastEl.addEventListener('click', hideToast);


/* ─────────────────────────────────────────────────────────────
   INITIALISATION
   Runs once on page load — restores the last viewed city.
───────────────────────────────────────────────────────────── */
(function init() {
  const lastCity = loadLastCity();
  if (lastCity) {
    document.getElementById('search-input').value = lastCity;
    loadWeatherForCity(lastCity);
  }
  // Otherwise the welcome screen is shown (initial render with empty state)
})();
