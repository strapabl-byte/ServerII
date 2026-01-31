require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'somatic-secure-key-2026-v1';

// Security Middleware
app.use(helmet({
    contentSecurityPolicy: false // Allow inline styles for dashboard
}));
app.use(cors());
app.use(express.json());
app.use(express.text());
app.use(express.static('public'));

// Rate Limiter
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests, please try again later.'
});

// Auth Middleware
const authenticate = (req, res, next) => {
    const apiKey = req.get('x-api-key');
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
    }
    next();
};

// In-memory storage
let currentStatus = {
    online: false,
    lastUpdate: 0,
    data: {}
};

let eventLogs = [];
const MAX_LOGS = 50;
const serverStartTime = Date.now();

// POST /update - Receive launcher updates
app.post('/update', apiLimiter, authenticate, (req, res) => {
    const payload = req.body;

    // Validate payload
    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    const eventType = payload.event?.type;
    if (!eventType) {
        return res.status(400).json({ error: 'Missing event type' });
    }

    // Update current status with flattened data structure
    currentStatus = {
        online: true,
        lastUpdate: Date.now(),
        data: {
            // Flatten for dashboard compatibility
            pid: payload.game?.pid || 0,
            uptime_seconds: payload.uptime_seconds || 0,
            crashes_120s: payload.crashes_120s || 0,
            total_restarts: payload.total_restarts || 0,
            state: payload.game?.state || 'OFF',
            exeName: payload.game?.exeName || 'Unknown',
            exePath: payload.game?.exePath || '',
            machineId: payload.machineId || 'Unknown',
            app: payload.app || 'SomaticLauncher'
        }
    };

    // Log significant events with descriptive messages
    if (eventType !== 'heartbeat') {
        const gameName = payload.game?.exeName || 'Launcher';
        const reason = payload.event?.reason || 'unknown';
        const pid = payload.game?.pid || 0;
        const restarts = payload.total_restarts || 0;

        let message = '';

        switch (eventType) {
            case 'launched':
                message = `🚀 Game Started: ${gameName} (PID: ${pid})`;
                break;
            case 'stopped':
                message = `⏹️ Game Stopped: ${gameName} (by ${reason})`;
                break;
            case 'crashed':
                message = `💥 Game Crashed: ${gameName} (Exit Code: Unknown)`;
                break;
            case 'relaunched':
                message = `🔄 Game Restarted: ${gameName} (Watchdog - Total Restarts: ${restarts})`;
                break;
            case 'selected':
                message = `📂 Game Selected: ${gameName}`;
                break;
            default:
                message = `[${eventType.toUpperCase()}] ${gameName} - ${reason}`;
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            time: new Date().toLocaleTimeString(),
            type: eventType
        };

        eventLogs.unshift(logEntry);
        if (eventLogs.length > MAX_LOGS) {
            eventLogs = eventLogs.slice(0, MAX_LOGS);
        }

        console.log(`[EVENT] ${message}`);
    }

    res.json({ success: true, received: eventType });
});

// POST /log - Receive detailed logs
app.post('/log', apiLimiter, authenticate, (req, res) => {
    let message = '';

    if (typeof req.body === 'string') {
        message = req.body;
    } else if (req.body && typeof req.body.message === 'string') {
        message = req.body.message;
    } else {
        return res.status(400).json({ error: 'Invalid log format' });
    }

    // Truncate very long messages
    if (message.length > 1000) {
        message = message.substring(0, 1000) + '...';
    }

    const logEntry = {
        timestamp: new Date().toISOString(),
        message,
        time: new Date().toLocaleTimeString(),
        type: 'log'
    };

    eventLogs.unshift(logEntry);
    if (eventLogs.length > MAX_LOGS) {
        eventLogs = eventLogs.slice(0, MAX_LOGS);
    }

    console.log(`[LOG] ${message}`);
    res.json({ success: true });
});

// GET /status - Public status endpoint for dashboard
app.get('/status', (req, res) => {
    // Check if offline (no update in 60 seconds)
    const timeSinceLast = Date.now() - currentStatus.lastUpdate;
    const isOnline = timeSinceLast < 60000 && currentStatus.online;

    // Calculate server uptime
    const serverUptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

    // Determine health based on crashes
    const crashes = currentStatus.data.crashes_120s || 0;
    let health = 'excellent';
    if (crashes >= 4) health = 'critical';
    else if (crashes >= 2) health = 'warning';
    else if (crashes >= 1) health = 'good';

    res.json({
        online: isOnline,
        lastUpdate: currentStatus.lastUpdate,
        lastUpdateTimestamp: currentStatus.lastUpdate,
        serverUptimeSeconds,
        health,
        data: currentStatus.data
    });
});

// GET /logs - Public logs endpoint
app.get('/logs', (req, res) => {
    res.json({ logs: eventLogs });
});

// GET / - Serve dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check for Render
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Somatic Launcher Server`);
    console.log(`📡 Running on port ${PORT}`);
    console.log(`🔐 API Key: ${API_KEY.substring(0, 10)}...`);
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});
