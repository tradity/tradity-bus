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
            id: 'othernode',
            desc: {
              id: 'othernode', handledEvents: ['foo']
            }
          }
        }
      ]
    },
    id: 'othernode'
  };
  
  const tripleNodeRemoteInfo = {
    graph: {
      elements: [
        {
          group: 'nodes',
          data: {
            id: 'node-b',
            desc: {id: 'node-b', handledEvents: ['foo', 'bar', 'baz']}
          }
        },
        {
          group: 'nodes',
          data: {
            id: 'node-c',
            desc: {id: 'node-c', handledEvents: ['foo', 'bar', 'xyz']}
          }
        },
        {
          group: 'nodes',
          data: {
            id: desc.id,
            desc: {id: desc.id, handledEvents: ['foo']}
          }
        },
        { // entry with index [3] (our “own”)
          group: 'edges',
          data: {
            id: 'a-b', weight: 10, isLocal: true,
            source: desc.id,
            target: 'node-b',
            emit: () => console.log('transport emit() called')
          }
        },
        {
          group: 'edges',
          data: {
            id: 'b-c', weight: 10, isLocal: false,
            source: 'node-b',
            target: 'node-c'
          }
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
    
    it('should accept a new edge when merging twice, with own edges', function() {
      const lGraph = new BusGraph(desc);
      
      return lGraph.mergeRemoteGraph(tripleNodeRemoteInfo, true).then(changed => {
        assert.ok(changed);
        
        assert.strictEqual(lGraph.stats().nodes, 3);
        assert.strictEqual(lGraph.stats().edges, 1);
        
        return lGraph.addTransport(tripleNodeRemoteInfo.graph.elements[3].data);
      }).then(() => {
        
        assert.strictEqual(lGraph.stats().nodes, 3);
        assert.strictEqual(lGraph.stats().edges, 2);
        
        return lGraph.mergeRemoteGraph(tripleNodeRemoteInfo, false);
      }).then(() => {
        assert.strictEqual(lGraph.stats().nodes, 3);
        assert.strictEqual(lGraph.stats().edges, 2);
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
      assert.deepEqual(graph.expandScope('nearest', 'foo'), [desc.id]);
      assert.deepEqual(graph.expandScope('local', 'foo'), [desc.id]);
      desc.handledEvents.delete('foo');
    });
    
    it('should return correct results for the 3-node graph', function() {
      const graph = new BusGraph(desc);
      
      return graph.mergeRemoteGraph(tripleNodeRemoteInfo, true).then(() => {
        assert.deepEqual(graph.expandScope('global', 'foo').sort(), ['node-b', 'node-c']);
        assert.deepEqual(graph.expandScope('global', 'bar').sort(), ['node-b', 'node-c']);
        assert.deepEqual(graph.expandScope('global', 'baz'), ['node-b']);
        assert.deepEqual(graph.expandScope('global', 'xyz'), ['node-c']);
        assert.deepEqual(graph.expandScope('local', 'foo'), []);
        assert.deepEqual(graph.expandScope('local', 'bar'), []);
        assert.deepEqual(graph.expandScope('immediate', 'foo'), []);
        assert.deepEqual(graph.expandScope('immediate', 'bar'), []);
        assert.deepEqual(graph.expandScope('nearest', 'foo'), []);
        assert.deepEqual(graph.expandScope('nearest', 'bar'), []);
        
        // add the missing edge
        return graph.addTransport(tripleNodeRemoteInfo.graph.elements[3].data);
      }).then(() => {
        assert.deepEqual(graph.expandScope('global', 'foo').sort(), ['node-b', 'node-c']);
        assert.deepEqual(graph.expandScope('global', 'bar').sort(), ['node-b', 'node-c']);
        assert.deepEqual(graph.expandScope('global', 'baz'), ['node-b']);
        assert.deepEqual(graph.expandScope('global', 'xyz'), ['node-c']);
        assert.deepEqual(graph.expandScope('neighbours', 'foo'), ['node-b']);
        assert.deepEqual(graph.expandScope('neighbours', 'bar'), ['node-b']);
        assert.deepEqual(graph.expandScope('neighbors', 'foo'), ['node-b']);
        assert.deepEqual(graph.expandScope('neighbors', 'bar'), ['node-b']);
        assert.deepEqual(graph.expandScope('local', 'foo'), ['node-b']);
        assert.deepEqual(graph.expandScope('local', 'bar'), ['node-b']);
        assert.deepEqual(graph.expandScope('immediate', 'foo'), []);
        assert.deepEqual(graph.expandScope('immediate', 'bar'), []);
        assert.deepEqual(graph.expandScope('nearest', 'foo'), ['node-b']);
        assert.deepEqual(graph.expandScope('nearest', 'bar'), ['node-b']);
        assert.deepEqual(graph.expandScope('nearest', 'baz'), ['node-b']);
        assert.deepEqual(graph.expandScope('nearest', 'xyz'), ['node-c']);
        assert.deepEqual(graph.listAllIds().sort(), [desc.id, 'node-b', 'node-c'].sort());
        
        return graph.removeTransport('a-b');
      }).then(() => {
        return graph.mergeRemoteGraph(tripleNodeRemoteInfo);
      }).then(() => {
        assert.deepEqual(graph.stats(), { nodes: 1, edges: 0});
      });
    });
  });
});
