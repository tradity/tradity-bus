"use strict";

const assert = require('assert');
const events = require('promise-events');

const bus = require('..');

describe('Bus', function() {
  let buses;
  let fooComponent;
  let barComponent;
  
  beforeEach('Create buses', function() {
    buses = [new bus.Bus(), new bus.Bus(), new bus.Bus()];
    
    return Promise.all(buses.map(b => b.init())).then(() => {
      class FooComponent extends bus.BusComponent {
        constructor() {
          super();
        }
      }
      
      FooComponent.prototype.foo = bus.provide('foo', ['a', 'b'], function(a, b) {
        return a + b;
      });
      
      fooComponent = new FooComponent();
      barComponent = new bus.BusComponent();
    }).then(() => {
      return Promise.all([
        fooComponent.setBus(buses[0]),
        barComponent.setBus(buses[1])
      ]);
    });
  });
  
  it('Cannot add transports before .init()', function() {
    assert.throws(() => new bus.Bus().addTransport(new bus.DirectTransport(new events.EventEmitter())));
  });
  
  it('Two Bus instances can be connected', function() {
    const em = new events.EventEmitter();
    const dt1 = new bus.DirectTransport(em);
    const dt2 = new bus.DirectTransport(em);
    
    return Promise.all([
      buses[0].addTransport(dt1),
      buses[1].addTransport(dt2)
    ]).then(() => {
      return em.emit('disconnect');
    }).then(() => {
      assert.deepEqual(buses[0].busGraph.stats(), { nodes: 1, edges: 0 });
      assert.deepEqual(buses[1].busGraph.stats(), { nodes: 1, edges: 0 });
    });
  });
  
  it('Can send requests across bus instances', function() {
    const em = new events.EventEmitter();
    const dt1 = new bus.DirectTransport(em);
    const dt2 = new bus.DirectTransport(em);
    
    return Promise.all([
      buses[0].addTransport(dt1),
      buses[1].addTransport(dt2)
    ]).then(() => {
      return barComponent.request({
        name: 'foo',
        a: 1,
        b: 2
      });
    }).then(result => {
      assert.strictEqual(result, 3);
      
      return fooComponent.unplugBus();
    }).then(() => {
      return barComponent.request({
        name: 'foo',
        a: 1,
        b: 2
      });
    }).catch(e => e).then(err => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.match(/Nonexistent event\/request type/));
    });
  });
});
