"use strict";

const assert = require('assert');
const debug = require('debug')('sotrade:bus:transport:internal');
const promiseUtil = require('../../lib/promise-util.js');

class BusTransport extends promiseUtil.EventEmitter {
  constructor() {
    super();
    
    this.weight = 1;
    this.isLocal = false;
    
    // properties set by bus
    this.source = null;
    this.target = null;
    this.id = null;
    this.msgCount = 0;
    
    // state properties
    this.disconnected = false;
    this.edgeId = null;
    this.bus = null;
    
    this.initedPromise = null;
  }
  
  init(bus) {
    if (this.initedPromise) {
      return this.initedPromise;
    }
    
    assert.ok(bus);
    this.bus = bus;
    this.edgeId = parseInt((1+Math.random()) * Date.now()).toString(36);
    
    debug('Create transport/edge', this.bus.id, this.edgeId);
    
    // Do a three-way handshake, similar to TCP
    // This has the purpose of checking connectivity
    // for both outgoing and incoming events
    return Promise.all([
      this.on('bus::handshakeSYN', data => {
        debug('Transport SYN', this.bus.id, this.edgeId, data.id, data.edgeId);
        
        if (data.id === this.bus.id) {
          return;
        }
        
        if (data.edgeId < this.edgeId) {
          this.edgeId = data.edgeId; // take minimum
        }
        
        return this.emit('bus::handshakeSYNACK', {id: this.bus.id, edgeId: this.edgeId})
          .then(() => this.bus.emitBusNodeInfo([this], true));
      }),
      
      this.on('bus::handshakeSYNACK', data => {
        debug('Transport SYN/ACK', this.bus.id, this.edgeId, data.id, data.edgeId);
        
        if (data.id === this.bus.id) {
          return;
        }
        
        if (data.edgeId < this.edgeId) {
          this.edgeId = data.edgeId; // take minimum
        }
        
        return this.bus.emitBusNodeInfo([this], true);
      })
    ]);
  }
  
  emitSYN() {
    return this.emit('bus::handshakeSYN', {id: this.bus.id, edgeId: this.edgeId});
  }
  
  assertInitialState() {
    assert.ok(this instanceof BusTransport);
    assert.strictEqual(this.source, null);
    assert.strictEqual(this.target, null);
    assert.strictEqual(this.id, null);
    assert.strictEqual(this.msgCount, 0);
    assert.strictEqual(this.bus, null);
  }
  
  toJSON() {
    return {
      weight: this.weight,
      isLocal: this.isLocal,
      source: this.source,
      target: this.target,
      id: this.id,
      msgCount: this.msgCount
    };
  }
}

module.exports = BusTransport;
