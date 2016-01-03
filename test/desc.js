"use strict";

const assert = require('assert');

const BusDescription = require('../lib/desc.js');

describe('BusDescription', function() {
  describe('constructor', function() {
    it('should populate a new description entry', function() {
      const desc = new BusDescription();
      
      assert.ok(desc.handledEvents instanceof Set);
      assert.strictEqual(desc.handledEvents.size, 0);
      assert.strictEqual(desc.msgCount, 0);
      assert.strictEqual(desc.lostPackets, 0);
      assert.ok(desc.hostname);
      assert.ok(desc.pid);
      assert.ok(desc.id);
      assert.strictEqual(typeof desc.id, 'string');
      assert.strictEqual(typeof desc.lastInfoTime, 'number');
    });
    
    it('should use existing data', function() {
      const desc = new BusDescription({
        handledEvents: ['a'],
        msgCount: 42
      });
      
      assert.ok(desc.handledEvents instanceof Set);
      assert.strictEqual(desc.handledEvents.size, 1);
      assert.strictEqual(desc.msgCount, 42);
    });
  });
  
  describe('#toJSON()', function() {
    it('Casts .handledEvents() to array', function() {
      const desc = new BusDescription({ handledEvents: ['a'] });
      assert.ok(desc.toJSON().handledEvents instanceof Array);
      assert.strictEqual(desc.toJSON().handledEvents.length, 1);
    });
  });
});
