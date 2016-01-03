"use strict";

const assert = require('assert');
const events = require('promise-events');

const Bus = require('../').Bus;
const DirectTransport = require('../').DirectTransport;

describe('Bus', function() {
  let buses, bus, init;
  
  beforeEach('Create buses', function() {
    buses = [new Bus(), new Bus(), new Bus()];
    bus = buses[0];
    init = () => Promise.all(buses.map(b => b.init()));
  });
  
  it('Cannot add transports before .init()', function() {
    assert.throws(() => bus.addTransport(new DirectTransport(new events.EventEmitter)));
  });
  
  it('Two Bus instances can be connected', function() {
    const em = new events.EventEmitter();
    const dt1 = new DirectTransport(em);
    const dt2 = new DirectTransport(em);
    
    return init().then(() => Promise.all([
      buses[0].addTransport(dt1),
      buses[1].addTransport(dt2)
    ])).then(() => {
      return em.emit('disconnect');
    }).then(() => {
      assert.deepEqual(buses[0].busGraph.stats(), { nodes: 1, edges: 0 });
      assert.deepEqual(buses[1].busGraph.stats(), { nodes: 1, edges: 0 });
    });
  });
});
