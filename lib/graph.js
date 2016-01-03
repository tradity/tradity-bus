"use strict";

const assert = require('assert');
const _ = require('lodash');
const cytoscape = require('cytoscape');
const objectHash = require('object-hash');
const debug = require('debug')('sotrade:bus:graph');
const promiseEvents = require('promise-events');

const BusDescription = require('./desc.js');

class BusGraph extends promiseEvents.EventEmitter {
  constructor(localNodeDesc) {
    super();
    this.setMaxListeners(0);
    
    assert.ok(localNodeDesc.id);
    
    this.c = cytoscape({
      headless: true,
      elements: [
        {
          group: 'nodes',
          data: {
            desc: localNodeDesc,
            id: localNodeDesc.id
          }
        }
      ]
    });
    
    this.removedTransports = new Set();
    this.ownNode = this.c.getElementById(localNodeDesc.id);
    assert.ok(this.ownNode);
    assert.ok(this.ownNode.isNode());
    this.updated();
    
    // cached properties
    this._dijkstra = null;
    this._localNodes = null;
  }
  
  get dijkstra() {
    if (this._dijkstra) {
      return this._dijkstra;
    }
    
    this._dijkstra = this.c.elements().dijkstra(this.ownNode, edge => edge.data().weight);
    
    assert.ok(this.dijkstra.distanceTo);
    assert.ok(this.dijkstra.pathTo);
    
    return this.dijkstra;
  }
  
  get localNodes () {
    if (this._localNodes) {
      return this._localNodes;
    }
    
    // select all nodes + local edges, take our connected component and out of these the nodes
    this._localNodes = this.c.filter('node, edge[?isLocal]')
      .connectedComponent(this.ownNode)
      .filter('node');
    
    assert.ok(this._localNodes);
    assert.ok(this._localNodes.length >= 1);
    assert.notStrictEqual(Array.from(this._localNodes).indexOf(this.ownNode), -1);
    
    debug('Checked for local nodes', this.ownNode.id(), this._localNodes.length);
    
    return this.localNodes;
  }
  
  get hash () {
    if (this._hash) {
      return this._hash;
    }
    
    this._hash = this.c.gHash();
    return this.hash;
  }
  
  updated() {
    this.ownNode = this.c.getElementById(this.ownNode.id());
    
    assert.ok(this.ownNode);
    assert.ok(this.ownNode.isNode());
    
    // invalidate cached properties
    this._dijkstra = null;
    this._localNodes = null;
    this._hash = null;
    
    return this.emit('updated');
  }
  
  // reload the graph, choosing only the current connected component
  localize() {
    const cc = this.c.elements().connectedComponent(this.ownNode);
    this.c.load(cc.map(e => e.json()));
    assert.ok(this.c.elements().length > 0);
    assert.ok(this.c.edges().length >= this.c.nodes().length - 1); // extreme case: tree
    
    debug('Localized bus graph', this.ownNode.id());
    
    return this.updated();
  }
  
  mergeRemoteGraph(busnode, doNotLocalize) {
    const remoteBusGraph = cytoscape(busnode.graph);
    remoteBusGraph.nodes().forEach(e => {
      const desc = new BusDescription(e.data().desc);
      e.data({desc: desc});
      assert.ok(e.data().desc instanceof BusDescription);
    });
    
    const lHash = this.hash;
    const rHash = remoteBusGraph.gHash();
    const rEdgeCount = remoteBusGraph.edges().length;
    const rNodeCount = remoteBusGraph.nodes().length;
    const lEdgeCount = this.c.edges().length;
    const lNodeCount = this.c.nodes().length;
    const lOwnEdges = this.ownNode.edgesWith(this.c.elements()).map(e => e.id());
    
    debug('Remote graph info', rNodeCount, rEdgeCount, rHash, lHash);
    
    if (rHash === lHash) {
      assert.strictEqual(rNodeCount, lNodeCount);
      assert.strictEqual(rEdgeCount, lEdgeCount);
      return Promise.resolve(false);
    }
    
    // const fs = require('fs');
    // fs.writeFileSync('/tmp/premerge-local', JSON.stringify(this.toJSON()));
    // fs.writeFileSync('/tmp/premerge-remote', JSON.stringify(busnode.graph));
    
    // remove all own edges from the remote bus graph, then take the union and
    // add our own edges later on
    remoteBusGraph.remove(remoteBusGraph.getElementById(this.ownNode.id()));
    this.c = remoteBusGraph.union(this.c);
    
    assert.ok(this.c.nodes().length >= rNodeCount - 1);
    assert.ok(this.c.nodes().length >= lNodeCount);
    assert.ok(this.c.edges().length >= lEdgeCount);
    
    // Remove edges from the graph of which the remote node is an endpoint (but we are not)
    // and which are not present in the remote graph;
    // Work with IDs since the nodes are in different Cytoscape instances
    const rEdgesInUnion = this.c.getElementById(busnode.id).edgesWith(this.c.elements()).map(e => e.id());
    const rEdgesInRGraph = remoteBusGraph.getElementById(busnode.id).edgesWith(remoteBusGraph.elements()).map(e => e.id());
    const ownEdges = this.ownNode.edgesWith(this.c.elements()).map(e => e.id());
    let edgesToRemove = _.difference(_.difference(rEdgesInUnion, rEdgesInRGraph), ownEdges);
    
    assert.deepEqual(lOwnEdges.sort(), ownEdges.sort());
    
    // remove edges that have been removed locally
    // (the remote may not yet be aware of that fact)
    edgesToRemove = _.union(edgesToRemove, Array.from(this.removedTransports));
    for (let edge of edgesToRemove) {
      this.c.remove(this.c.getElementById(edge));
    }
    
    // localization can be supressed, e. g. because we just received an initial node info
    // and the edge that keeps the graph connected is yet to be added
    // (localizing refers to taking only the current connected component)
    return Promise.resolve().then(() => {
      if (!doNotLocalize) {
        return this.localize();
      }
    }).then(() => {
    // fail early in case we cannot use one of our own edges as a transport
      this.ownNode.edgesWith(this.c.elements()).forEach(e => {
        assert.ok(e);
        assert.ok(e.data().emit);
      });
      
      // fs.writeFileSync('/tmp/postmerge', JSON.stringify(this.toJSON()));
    
      return this.updated();
    }).then(() => true);
  }
  
  stats() {
    return {
      nodes: this.c.nodes().length,
      edges: this.c.edges().length,
    };
  }
  
  toJSON() {
    return this.c.json();
  }
  
  getNode(id) {
    return this.c.getElementById(id);
  }
  
  getNodes(filter) {
    return this.c.nodes().filter(filter);
  }
  
  removeTransport(id) {
    debug('Remove transport', id);
    this.removedTransports.add(id);
    
    return Promise.resolve().then(() =>
      this.c.remove(this.c.getElementById(id))
    ).then(() => this.updated());
  }
  
  addTransport(transport) {
    debug('Add transport', transport.id);
    this.removedTransports.delete(transport.id);
    
    return Promise.resolve().then(() =>
      this.c.add({
        group: 'edges',
        data: transport
      })
    ).then(() => this.updated());
  }
  
  listAllIds() {
    return this.c.nodes().map(e => e.id());
  }
  
  expandScope(scope, eventType) {
    const eventTypeFilter = (i, e) => {
      return e.isNode() && e.data().desc.handledEvents.has(eventType);
    };
    
    switch (scope) {
      case 'immediate':
        scope = !this.ownNode.data().desc.handledEvents.has(eventType) ? [] : [this.ownNode.id()];
        break;
      case 'local':
        scope = this.localNodes.filter(eventTypeFilter).map(e => e.id());
        break;
      case 'neighbors': // meh
      case 'neighbours':
        scope = this.ownNode.closedNeighbourhood().nodes().filter(eventTypeFilter).map(e => e.id());
        break;
      case 'nearest':
        // take a shortcut if we provide the relevant event ourselves
        // this proably happens quite often
        if (this.ownNode.data().desc.handledEvents.has(eventType)) {
          scope = [this.ownNode.id()];
          break;
        }
        
        // determine all nodes accepting our eventType
        const possibleTargetNodes = this.getNodes(eventTypeFilter);
        
        if (possibleTargetNodes.length === 0) {
          scope = [];
          break;
        }
        
        // find nearest of these
        const nearest = _.min(
          possibleTargetNodes,
          e => this.dijkstra.distanceTo(e)
        );
        
        if (this.dijkstra.distanceTo(nearest) === Infinity) {
          scope = [];
          break;
        }
        
        assert.notStrictEqual(nearest.id(), this.ownNode.id());
        
        scope = [nearest.id()];
        break;
      case 'global':
        scope = this.c.filter(eventTypeFilter).map(e => e.id());
        break;
      default:
        throw new RangeError('You need to specifiy a valid scope identifier');
    }
    
    assert.ok(_.isArray(scope));
    return scope;
  }
}

/* cytoscape connected component extension */
cytoscape('collection', 'connectedComponent', function(root) {
  return this.breadthFirstSearch(root).path;
});

/* cytoscape graph hashing extension */
cytoscape('core', 'gHash', function(opt) {
  opt = opt || {};
  opt.respectType = opt.respectType || false;
  
  const nodes = this.nodes();
  const nodeData = {};
  
  nodes.forEach(v => {
    nodeData[v.id()] = [
      v.data().desc.handledEvents,
      v.edgesWith(nodes).map(e => e.id()).sort()
    ];
  });
  
  return objectHash(nodeData, opt);
});

/* cytoscape graph union extension */
cytoscape('core', 'union', function(g2) {
  const g1 = this;
  
  const elements = [];
  const j1 = g1.json();
  const j2 = g2.json();
  
  const edges = (j1.elements.edges || []).concat(j2.elements.edges || []);
  const nodes = (j1.elements.nodes || []).concat(j2.elements.nodes || [])
    .sort((a, b) => // sort in descending order of lastInfoTime
      b.data.desc.lastInfoTime - a.data.desc.lastInfoTime
    );
  
  const lists = [nodes, edges];
  const ids = {};
  
  for (let i = 0; i < lists.length; ++i) {
    assert.ok(lists[i]);
    
    for (let j = 0; j < lists[i].length; ++j) {
      const e = lists[i][j];
      
      if (ids[e.data.id]) {
        assert.equal(e.group, ids[e.data.id]);
        continue;
      }
      
      ids[e.data.id] = e.group;
      elements.push(e);
    }
  }
  
  return cytoscape({elements: elements});
});

module.exports = BusGraph;
