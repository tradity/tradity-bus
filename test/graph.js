"use strict";

const assert = require('assert');

const BusGraph = require('../lib/graph.js');
const BusDescription = require('../lib/desc.js');

describe('BusGraph', function() {
  const desc = new BusDescription();
  
  const singleNodeRemoteInfo = {
    graph: {
      elements: [
        {
          group: 'nodes',
          data: {
            desc: {id: 'othernode', handledEvents: ['foo']},
            id: 'othernode'
          }
        }
      ]
    },
    id: 'othernode'
  };
  
  const tripeNodeInfo = {
    graph: {
      elements: [
        {
          group: 'nodes',
          data: {id: 'node-b', handledEvents: ['foo', 'bar', 'baz']},
          id: 'node-b'
        },
        {
          group: 'nodes',
          data: {id: 'node-c', handledEvents: ['foo', 'bar', 'xyz']},
          id: 'node-c'
        },
        {
          group: 'nodes',
          data: {id: desc.id, handledEvents: ['foo']},
          id: desc.id
        },
        {
          group: 'edges'
        }
      ]
    },
    id: 'node-b'
  };
  
  describe('constructor', function() {
    it('should create a new bus graph', function() {
      const graph = new BusGraph(desc);
      
      assert.ok(graph.hash);
      assert.ok(graph.dijkstra);
      assert.strictEqual(graph.localNodes.length, 1);
    });
  });
  
  describe('#mergeRemoteGraph(·, true)', function() {
    it('should add another node as is', function() {
      const lGraph = new BusGraph(desc);
      
      return lGraph.mergeRemoteGraph(singleNodeRemoteInfo, true).then(changed => {
        assert.ok(changed);
        
        assert.strictEqual(lGraph.stats().nodes, 2);
        assert.strictEqual(lGraph.stats().edges, 0);
        
        return lGraph.localize();
      }).then(() => {
        assert.strictEqual(lGraph.stats().nodes, 1);
        assert.strictEqual(lGraph.stats().edges, 0);
      });
    });
    
    it('should not change anything when merging twice', function() {
      const lGraph = new BusGraph(desc);
      let hashBefore;
      
      return lGraph.mergeRemoteGraph(singleNodeRemoteInfo, true).then(changed => {
        assert.ok(changed);
        
        assert.strictEqual(lGraph.stats().nodes, 2);
        assert.strictEqual(lGraph.stats().edges, 0);
        
        hashBefore = lGraph.hash;
        
        return lGraph.mergeRemoteGraph({
          graph: lGraph.toJSON(),
          id: desc.id
        }, true);
      }).then(changed => {
        assert.ok(!changed);
        
        assert.strictEqual(lGraph.stats().nodes, 2);
        assert.strictEqual(lGraph.stats().edges, 0);
        assert.strictEqual(lGraph.hash, hashBefore);
      });
    });
  });
  
  describe('#mergeRemoteGraph(·, false)', function() {
    it('should ignore add another edgeless node', function() {
      const lGraph = new BusGraph(desc);
      
      return lGraph.mergeRemoteGraph(singleNodeRemoteInfo, false).then(() => {
        assert.strictEqual(lGraph.stats().nodes, 1);
        assert.strictEqual(lGraph.stats().edges, 0);
      });
    });
  });
  
  describe('#getNode()', function() {
    it('should return the own node for the own id', function() {
      const graph = new BusGraph(desc);
      
      assert.strictEqual(graph.getNode(desc.id), graph.ownNode);
    });
  });
  
  describe('#expandScope()', function() {
    it('should never return anything when no events are handled', function() {
      const graph = new BusGraph(desc);
      
      assert.deepEqual(graph.expandScope('immediate', 'foo'), []);
      assert.deepEqual(graph.expandScope('local', 'foo'), []);
      assert.deepEqual(graph.expandScope('nearest', 'foo'), []);
      assert.deepEqual(graph.expandScope('global', 'foo'), []);
    });
    
    it('should fail for invalid scope specifiers', function() {
      const graph = new BusGraph(desc);
      
      assert.throws(() => graph.expandScope('banana', 'foo'), /You need to specifiy a valid scope identifier/);
      assert.throws(() => graph.expandScope('banana', 'foo'), /You need to specifiy a valid scope identifier/);
    });
    
    it('should return the own local node for "immediate"', function() {
      const graph = new BusGraph(desc);
      
      assert.deepEqual(graph.expandScope('immediate', 'foo'), []);
      desc.handledEvents.add('foo');
      assert.deepEqual(graph.expandScope('immediate', 'foo'), [desc.id]);
      desc.handledEvents.delete('foo');
    });
    
    
  });
});
