require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Supabase (SERVICE ROLE)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =======================
// 🔒 STATUS LOGIC (SINGLE SOURCE OF TRUTH)
// =======================
const calculateStatus = (distance) => {
  if (distance < 5) return 'danger';
  if (distance < 15) return 'warning';
  return 'safe';
};

// =======================
// MQTT SETUP
// =======================
const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');

mqttClient.on('connect', () => {
  console.log('✅ MQTT CONNECTED');
  mqttClient.subscribe('distance', (err) => {
    if (err) console.error('❌ MQTT SUBSCRIBE ERROR:', err);
    else console.log('📡 SUBSCRIBED TO TOPIC: distance');
  });
});

// =======================
// MQTT MESSAGE HANDLER
// =======================
mqttClient.on('message', async (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    const distance = Number(payload.distance);

    if (Number.isNaN(distance)) {
      throw new Error('Invalid distance value');
    }

    // 🔥 HITUNG STATUS DI BACKEND
    const status = calculateStatus(distance);

    const { error } = await supabase
      .from('sensor_data')
      .insert({
        profiles_id: process.env.PROFILES_ID,
        distance,
        status
      });

    if (error) {
      console.error('❌ SUPABASE INSERT ERROR:', error.message);
    } else {
      console.log('✅ DATA SAVED:', { distance, status });
    }
  } catch (err) {
    console.error('❌ MQTT MESSAGE ERROR:', err.message);
  }
});

// =======================
// HEALTH CHECK
// =======================
app.get('/', (req, res) => {
  res.send('Backend MQTT + Supabase running');
});

// =======================
// API: GET SENSOR DATA
// =======================
app.get('/api/sensor', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sensor_data')
      .select('*')
      .eq('profiles_id', process.env.PROFILES_ID)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error('❌ GET SENSOR ERROR:', err.message);
    res.status(500).json({ error: 'Failed to fetch sensor data' });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
