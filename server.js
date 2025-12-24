require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const calculateStatus = (distanceCm) => {
  if (distanceCm < 5) return 'danger';
  if (distanceCm < 15) return 'warning';
  return 'safe';
};

const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');

mqttClient.on('connect', () => {
  console.log('✅ MQTT CONNECTED');
  mqttClient.subscribe('distance', (err) => {
    if (err) console.error('❌ MQTT SUBSCRIBE ERROR:', err);
    else console.log('📡 SUBSCRIBED TO TOPIC: distance');
  });
});

mqttClient.on('message', async (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());

    const rawDistanceMm = Number(payload.distance);

    if (Number.isNaN(rawDistanceMm)) {
      throw new Error('Invalid distance value from sensor');
    }

    const distanceCm = Number((rawDistanceMm / 10).toFixed(2));

    const status = calculateStatus(distanceCm);

    const { error } = await supabase
      .from('sensor_data')
      .insert({
        profiles_id: process.env.PROFILES_ID,
        distance: distanceCm, // ✅ SIMPAN CM
        status
      });

    if (error) {
      console.error('❌ SUPABASE INSERT ERROR:', error.message);
    } else {
      console.log('✅ DATA SAVED:', {
        raw_mm: rawDistanceMm,
        cm: distanceCm,
        status
      });
    }
  } catch (err) {
    console.error('❌ MQTT MESSAGE ERROR:', err.message);
  }
});

app.get('/', (req, res) => {
  res.send('Backend MQTT + Supabase running');
});

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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
