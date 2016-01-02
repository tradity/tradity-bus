"use strict";

const crypto = require('crypto');
const os = require('os');

class BusDescription {
  constructor(data) {
    data = data || {};
    this.handledEvents = new Set(data.handledEvents || []);
    this.msgCount = data.msgCount || 0;
    this.lostPackets = data.lostPackets || 0;
    this.hostname = data.hostname || os.hostname();
    this.pid = data.pid || process.pid;
    this.id = data.id || this.determineBusID();
    this.lastInfoTime = data.lastInfoTime || Date.now();
    this.lastPublishedGHash = null;
  }
  
  determineBusID() {
    // return hostname and hash of network interfaces, process id, current time
    return this.hostname + '-' + sha256(JSON.stringify(os.networkInterfaces()) + '|' +
      this.pid + '|' + Date.now() + '|' + Math.random()).substr(0, 12);
  }
  
  toJSON() {
    return {
      id: this.id,
      handledEvents: Array.from(this.handledEvents),
      msgCount: this.msgCount,
      lostPackets: this.lostPackets,
      hostname: this.hostname,
      pid: this.pid,
      lastInfoTime: this.lastInfoTime
    };
  }
}

module.exports = BusDescription;

function sha256(s) {
  const h = crypto.createHash('sha256');
  h.end(s);
  return h.read().toString('hex');
}
