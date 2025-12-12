require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const cors = require('cors');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.emqx.io:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'stylesync/distance';
const PORT = process.env.PORT || 3000;

// const DB_HOST = process.env.DB_HOST || 'localhost';
// const DB_PORT = process.env.DB_PORT || 3306;
// const DB_USER = process.env.DB_USER || 'root';
// const DB_PASS = process.env.DB_PASS || '';
// const DB_NAME = process.env.DB_NAME || 'stylesync';

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'styn6457';
const DB_PASS = process.env.DB_PASS || '@Pakrifqi12';
const DB_NAME = process.env.DB_NAME || 'styn6457_StyleSync';

let db;

// Helper: compute status from distance
function computeStatus(distance) {
    if (distance <= 0 || isNaN(distance)) return 'safe';
    if (distance < 5) return 'danger';
    if (distance < 15) return 'warning';
    return 'safe';
}

async function initDb() {
    db = await mysql.createPool({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

// Start express + socket.io
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Simple REST: get latest value
app.get('/api/latest', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM latest_value WHERE id = 1 LIMIT 1');
        res.json(rows[0] || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db error' });
    }
});

// REST: recent logs
app.get('/api/logs', async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    try {
        const [rows] = await db.query('SELECT * FROM logs ORDER BY created_at DESC LIMIT ?', [limit]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db error' });
    }
});

// REST: recent alerts
app.get('/api/alerts', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'db error' });
    }
});

server.listen(PORT, async () => {
    try {
        await initDb();
        console.log(`HTTP + Socket.IO listening on :${PORT}`);
        // connect mqtt after DB ready
        startMQTT();
    } catch (err) {
        console.error('DB init error', err);
    }
});

// Socket.IO connection logs
io.on('connection', (socket) => {
    console.log('Socket connected', socket.id);
    socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});

// MQTT client
let mqttClient;
function startMQTT() {
    mqttClient = mqtt.connect(MQTT_URL, { reconnectPeriod: 2000 });

    mqttClient.on('connect', () => {
        console.log('Connected to MQTT broker:', MQTT_URL);
        mqttClient.subscribe(MQTT_TOPIC, (err) => {
            if (err) console.error('Subscribe error', err);
            else console.log('Subscribed to', MQTT_TOPIC);
        });
    });

    mqttClient.on('error', (err) => console.error('MQTT error', err));

    mqttClient.on('message', async (topic, message) => {
        try {
            // parse payload: expect JSON like {"distance": 12.34}
            const text = message.toString();
            let payload;
            try {
                payload = JSON.parse(text);
            } catch (e) {
                // fallback: support {"msg":"7"} or plain number
                try {
                    payload = JSON.parse(text.replace(/['"]/g, '"'));
                } catch (err) {
                    payload = { distance: parseFloat(text) || null };
                }
            }

            const distance = parseFloat(payload.distance ?? payload.msg ?? payload.value ?? null);
            const status = computeStatus(distance);

            // insert to logs
            await db.query('INSERT INTO logs(distance, status) VALUES (?, ?)', [distance || 0, status]);

            // update latest_value table
            await db.query('UPDATE latest_value SET distance = ?, status = ?, updated_at = NOW() WHERE id = 1', [distance || 0, status]);

            // insert alerts for warning/danger
            if (status === 'warning' || status === 'danger') {
                const msg = status === 'danger' ?
                    `Jarak tangan terdeteksi ${distance} cm - BAHAYA!` :
                    `Jarak tangan terdeteksi ${distance} cm - Waspada`;
                await db.query('INSERT INTO alerts(message, level) VALUES (?, ?)', [msg, status]);
            }

            // emit to dashboard
            io.emit('distance_update', { distance, status, ts: new Date().toISOString() });

            console.log('Saved distance:', distance, 'status:', status);
        } catch (err) {
            console.error('On message error:', err);
        }
    });
}
