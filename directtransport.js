"use strict";

const _ = require('lodash');
const assert = require('assert');
const BusTransport = require('./transport.js');

class DirectTransport extends BusTransport {
  constructor(baseEmitter, weight, isLocal) {
    super();
    assert.ok(baseEmitter);
    
    this.baseEmitter = baseEmitter;
    this.isLocal = isLocal || baseEmitter.isLocal || false;
    this.weight = weight || baseEmitter.weight || 1;
  }
  
  on(event, listener) {
    return Promise.resolve()
      .then(() => this.baseEmitter.on(event, listener));
  }
  
  emit() {
    const args = Array.from(arguments);
    return Promise.resolve()
      .then(() => this.baseEmitter.emit(...args));
  }
  
  toJSON() {
    return _.omit(this, 'baseEmitter');
  }
}

module.exports = DirectTransport;
