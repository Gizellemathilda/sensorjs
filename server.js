require('dotenv').config();
const mqtt = require('mqtt');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase (SERVICE ROLE)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// MQTT
const mqttClient = mqtt.connect('mqtt://broker.emqx.io:1883');

mqttClient.on('connect', () => {
  console.log('MQTT CONNECTED');
  mqttClient.subscribe('distance');
});

mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    const { error } = await supabase
      .from('sensor_data')
      .insert({
        profiles_id: process.env.PROFILEs_ID,
        distance: data.distance,
        status: data.status
      });

    if (error) {
      console.error('SUPABASE INSERT ERROR:', error.message);
    } else {
      console.log('DATA SAVED:', data);
    }
  } catch (err) {
    console.error('MQTT PARSE ERROR');
  }
});

// health check
app.get('/', (req, res) => {
  res.send('Backend MQTT + Supabase running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

