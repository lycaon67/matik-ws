require('dotenv').config()
const express = require('express');
const app = express();
const http = require('http');
const httpServer = http.createServer(app);
const socketio = require('socket.io');
const { Server } = require("socket.io");
var dbConn = require('./db');
const PORT = process.env.PORT || 8000
const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

// Check for changes every second
function groupByDevice(arr){
  return arr.reduce((result, currentItem) => {
    (result[currentItem.device_id] = result[currentItem.device_id] || []).push(currentItem);
    return result;
  }, {});
}

function getNonMatchingIndices(arr1, arr2) {
  let nonMatchingIndices = [];
  for(let i = 0; i < arr1.length; i++) {
      // Convert objects to string for comparison
      if(JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) {
          nonMatchingIndices.push(arr1[i]);
      }
  }

  prev_results = arr2

  return nonMatchingIndices;
}

function get_channel_info(channel) {
  return new Promise(function(resolve, reject){
    let sql = `SELECT * FROM channels WHERE id = '${channel}'`
    dbConn.query(sql, function(err,rows)     {
      if(err) {
        reject(err)
      } else {
        // console.log("[channel]", channel, rows[0]);
        resolve(rows[0])
      }
    });
  })
}

function get_home_info(id) {
  return new Promise(function(resolve, reject){
    let sql = `SELECT * FROM homes WHERE id = '${id}'`
    dbConn.query(sql, function(err,rows)     {
      if(err) {
        reject(err)
      } else {
        resolve(rows[0])
      }
    });
  })
}




function get_device(homeId){
  return new Promise(function(resolve, reject){
    let sql = `SELECT * FROM devices WHERE home_id = '${homeId}'`
    dbConn.query(sql, async function(err,rows)     {
      if(err) {
        reject(err)
      } else {
        var res_device = []
        for (let index = 0; index < rows.length; index++) {
          const element = rows[index];
          var device_channel = []
          await get_channel(element.id)
            .then((channel)=>{
              channel?.map((channel) => {
                let now = new Date();
                const timeDifferenceMs = now - new Date(element['updated_at']);
                if(timeDifferenceMs > 60e3){
                  channel['device_status'] = 0
                }else {
                  channel['device_status'] = 1
                }
                device_channel.push(channel)
              })
            })
            .catch((err)=>{
                throw err
            })
          
          res_device = res_device.concat(device_channel)
          
        }
        resolve(res_device);
      }
    });
  })
}

function get_channel(deviceId){
  return new Promise(function(resolve, reject){
    let sql = `SELECT * FROM channels WHERE device_id = '${deviceId}'`
    dbConn.query(sql,function(err,rows)     {
      if(err) {
        reject(err)
      } else {
        resolve(rows)
      }
    });
  })
}

function update_channel(channelData){
  return new Promise(function(resolve, reject){
    let sql = `UPDATE channels SET status = '{"on": ${channelData.status}}' WHERE id = "${channelData.channelId}";`
    dbConn.query(sql,function(err,rows) {
      if(err) {
        reject(err)
      } else {
        resolve(rows)
      }
    });
  })
}


var prev_results = [];

io.on("connection", (socket) => {
  let devices = []
  let prev_devices = []

  function DBListener() {
    try {
      dbConn.query('SELECT * FROM devices', function async (err, result) {
        if (err) throw err;
        if (result) {
          if(JSON.stringify(prev_devices) == JSON.stringify(result)){
            
          }else{
            let temp_device = []
            for( const [idx, res] of result.entries()){
              if(prev_devices[idx] != null){
                if(String(prev_devices[idx]?.updated_at) != String(res?.updated_at)){
                  temp_device.push(res)
                }
              }
            }
            
            const grouped = temp_device.reduce((res, currentItem) => {
              (res[currentItem.home_id] = res[currentItem.home_id] || []).push(currentItem);
              return res;
            }, {});

  
            Object.keys(grouped).map(async (homeId) => {
              socket.emit(`db_devices_${homeId}`, null);
            })
          }
          prev_devices = result
          
        }

      })
    } catch(err){

    }
    
  }
    
  setInterval(()=>DBListener(), 10000);


  socket.on("disconnect", ()=>{
  })


  socket.on("channel", async(homeId, data, userData) => {
    await update_channel(JSON.parse(data))
      .then(async (res) => {
        await get_device(homeId.replaceAll("-",""))
          .then((res)=>{
            devices = res
          })
          .catch((err)=>{
              throw err
          })
        // io.emit("home_devices", devices)
        let channelInfo = await get_channel_info(JSON.parse(data)?.channelId)
        let homeInfo = await get_home_info(homeId)
        console.log(`[Info] Device: ${channelInfo?.device_id} - Channel: ${channelInfo?.id}-[${channelInfo?.name}] in Home ${homeInfo?.id}-[${homeInfo?.name}] is updated by ${userData?.username}`);
        io.emit(`devices_${homeId}`, devices);
      })
  });


  socket.on("home_device", async(homeId) => {
    if(homeId){
      socket.join(homeId);
      await get_device(homeId)
        .then((res)=>{
          devices = res
        })
        .catch((err)=>{
            throw err
        })
      io.emit(`devices_${homeId}`, devices);
    }
  });
});


httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on *:${PORT}`);
});