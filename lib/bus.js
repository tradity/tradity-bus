"use strict";

const _ = require('lodash');
const assert = require('assert');
const zlib = require('zlib');
const promiseEvents = require('promise-events');

const debug = require('debug')('sotrade:bus');
const debugEvents = require('debug')('sotrade:bus:events');
const debugPackets = require('debug')('sotrade:bus:packets');
const debugTransport = require('debug')('sotrade:bus:transport');
const debugNetwork = require('debug')('sotrade:bus:network');
const debugMisc = require('debug')('sotrade:bus:misc');

const zlibNCall = fn => buf =>
  new Promise((resolve, reject) => fn(buf, (err, ret) => err ? reject(err) : resolve(ret)));

const inflate = zlibNCall(zlib.inflate);
const deflate = zlibNCall(zlib.deflate);

const BusDescription = require('./desc.js');
const BusGraph = require('./graph.js');

class Bus extends promiseEvents.EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    
    this.desc = new BusDescription();
    
    debug('Creating bus', this.id);
    
    this.curId = 0;
    this.busGraph = new BusGraph(this.desc);
    
    this.setMaxListeners(0);
    this.responseWaiters = new Map();
    
    this.busNodeInfoEmittingPromise = null;
    
    this.transports = new Set();
    
    this.connectingTransports = new Set();
    
    this.inputFilters = [];
    this.outputFilters = [];
    
    this.initedPromise = null;
  }
  
  init() {
    if (this.initedPromise) {
      return this.initedPromise;
    }
    
    return this.initedPromise = Promise.all([
      this.on('newListener', this.newListener),
      this.on('removeListener', this.removeListener)
    ]).then(() => Promise.all([
      this.on('bus::nodeInfo', this.nodeInfoHandler),
      this.busGraph.on('updated', () => {
        // inform response waiters that nodes may have been removed and are therefore not able to answer requests
        for (let w of this.responseWaiters.values()) {
          if (w.handleResponse) {
            w.handleResponse(null);
          }
        }
      })
    ])).then(() => {
      assert.ok(this.handledEvents.has('bus::nodeInfo'));
      
      debug('Created bus', this.id);
      return this;
    });
  }

  newListener(event) {
    debugEvents('Add new listener', this.id, event);
    
    if (!this.handledEvents.has(event)) {
      this.handledEvents.add(event);
      
      return this.busGraph.updated().then(() => this.emitBusNodeInfoSoon());
    }
  }
  
  removeListener(event) {
    debugEvents('Remove listener', this.id, event);
    if (this.listeners(event).length === 0) {
      this.handledEvents.delete(event);
      
      return this.busGraph.updated().then(() => this.emitBusNodeInfoSoon());
    }
  }
  
  nodeInfoHandler(data) {
    debugNetwork('Received nodeInfo', this.id);
    if (!Buffer.isBuffer(data)) {
      data = new Buffer(data);
    }
    
    return inflate(data).then((data) => {
      try {
        data = JSON.parse(data);
      } catch (e) {
        throw new Error('Error parsing JSON data: ' + data + ', message = ' + e.message);
      }
      
      assert.ok(data.id && _.isString(data.id));
      assert.ok(data.graph);
      assert.ok(data.handledEvents && _.isArray(data.handledEvents));
      
      if (data.id === this.id) {
        return;
      }
      
      debugNetwork('Parsed nodeInfo', this.id + ' <- ' + data.id);
      
      return this.handleTransportNodeInfo(data).then(() => {
        return this.emitBusNodeInfoSoon();
      });
    });
  }
  
  get id() {
    return this.desc.id;
  }
  
  get handledEvents() {
    return this.desc.handledEvents;
  }
  
  toJSON() {
    return {
      id: this.id,
      handledEvents: Array.from(this.handledEvents),
      msgCount: this.msgCount,
      lostPackets: this.lostPackets,
      hostname: this.hostname,
      pid: this.pid
    };
  }
  
  emitBusNodeInfoSoon() {
    if (this.busNodeInfoEmittingPromise) {
      return this.busNodeInfoEmittingPromise;
    }
    
    debugNetwork('emitBusNodeInfoSoon', this.id);
    
    return this.busNodeInfoEmittingPromise =
      Promise.resolve().then(() => {
      this.busNodeInfoEmittingPromise = null;
      
      return this.emitBusNodeInfo();
    });
  }

  emitBusNodeInfo(transports, initial) {
    if (this.busGraph.hash !== this.desc.lastPublishedGHash) {
      // only update lastInfoTime if something changed
      this.desc.lastInfoTime = Date.now();
      this.desc.lastPublishedGHash = this.busGraph.hash;
    } else {
      if (!initial) {
        debugNetwork('Suppress bus node info emitting due to unchanged graph info',
          this.id, this.busGraph.hash);
        return;
      }
    }
    
    const info = Object.assign({}, this.toJSON(), { graph: this.busGraph.toJSON() });
    
    debugNetwork('emitBusNodeInfo', this.id,
      'with transports ' + (transports || []).map(t => t.id).join(' '),
      initial ? 'initial' : 'non-initial', info.sendTime);

    return deflate(JSON.stringify(info)).then(encodedInfo => {
      // note that initial infos are transport events, whereas
      // non-initial infos are bus events (and therefore bus packets)
      if (initial) {
        transports = transports || this.transports;
        
        // Array comprehensions would be better here
        return Promise.all(Array.from(transports).map(
          t => t.emit('bus::nodeInfoInitial', encodedInfo)
        ));
      } else {
        return this.emitScoped('bus::nodeInfo', encodedInfo, 'neighbours');
      }
    });
  }

  addTransport(transport) {
    transport.assertInitialState();
    
    this.connectingTransports.add(transport);
    
    return transport.init(this).then(() => Promise.all([
      transport.on('bus::nodeInfoInitial', data => { // ~ ACK after SYN-ACK
        if (!Buffer.isBuffer(data)) {
          data = new Buffer(data);
        }
        
        return inflate(data).then(data => {
          data = JSON.parse(data);
          assert.ok(data.id);
          if (data.id === this.id) {
            return null;
          }
          
          debugTransport('Received initial bus node info', this.id, transport.edgeId, data.id);
          assert.ok(this.connectingTransports.size > 0);
          
          return this.handleTransportNodeInfo(data) // modifies this.busGraph!
          .then(() => data.id)
          .then(remoteNodeID => {
            const nodeIDs = [remoteNodeID, this.id].sort(); // sort for normalization across nodes
            const transportGraphID = nodeIDs.join('-') + '-' + transport.edgeId;
            
            assert.ok(this.busGraph.getNode(nodeIDs[0]).isNode());
            assert.ok(this.busGraph.getNode(nodeIDs[1]).isNode());
            
            // remove the edge, if present, since it may have been updated
            // during reading the remote node info
            // (in which case emit() & co are missing!)
            this.busGraph.removeTransport(transportGraphID);
            
            transport.source = nodeIDs[0];
            transport.target = nodeIDs[1];
            transport.id = transportGraphID;
            transport.msgCount = 0;
            
            this.busGraph.addTransport(transport);
            
            return this.busGraph.updated();
          }).then(() => {
            this.transports.add(transport);
            
            this.emitBusNodeInfoSoon();
            
            debugTransport('Handled initial bus node info', this.id, transport.edgeId);
            
            return this.connectingTransports.delete(transport);
          });
        });
      }),
      
      transport.on('bus::packet', (p) => {
        assert.ok(p.immediateSender.id);
        if (p.immediateSender.id === this.id) { // comes directly from .emit()
          return;
        }
        
        transport.msgCount++;
        
        return this.handleBusPacket(p);
      }),
      
      transport.on('disconnect', (reason) => {
        debugTransport('Received transport disconnect', this.id, transport.edgeId, reason);
        this.connectingTransports.delete(transport);
        
        this.busGraph.removeTransport(transport.id);
        this.transports.delete(transport);
        this.busGraph.localize();
        return this.busGraph.updated().then(() => {
          debugTransport('Handled transport disconnect', this.id, transport.edgeId);
        });
      })
    ])).then(() => transport.emitSYN());
  }

  handleTransportNodeInfo(busnode) {
    const doNotLocalize = this.connectingTransports.size > 0;
    debugNetwork('Handling transport node info', this.id, busnode.id, doNotLocalize, this.busGraph.stats());
    
    return this.busGraph.mergeRemoteGraph(busnode, doNotLocalize).then((changed) => {
      debugNetwork('Handled transport node info', this.id, busnode.id, doNotLocalize, this.busGraph.stats());
      
      if (changed) {
        return;
      }
      
      debugNetwork('Scheduling bus node info after graph change', this.id, this.busGraph.hash);
      this.emitBusNodeInfoSoon();
    });
  }

  handleBusPacket(packet) {
    assert.ok(this.initedPromise);
    assert.ok(this.id);
    assert.notStrictEqual(packet.immediateSender && packet.immediateSender.id, this.id);
    
    packet = Object.assign({}, packet);
    this.msgCount++;
    
    const hasAlreadySeen = packet.seenBy.indexOf(this.id) !== -1;
    if (hasAlreadySeen ||
        (packet.immediateSender &&
          packet.immediateSender.graphHash !== this.busGraph.hash))
    {
      // in the case of hasAlreadySeen == true:
      // how did we end up here? chances are, some node to which
      // we transmitted the packet has a different bus graph and sent
      // the packet back to us, so either our graph or theirs is outdated.
      // we emit a new bus node info now.
      //
      // in the case of different hashes:
      // no harm in sending updates, this is just a good occasion since
      // we know that at least one node is interested
      this.emitBusNodeInfoSoon();
    } else {
      packet.seenBy.push(this.id);
    }
    
    packet.immediateSender = {
      id: this.id,
      graphHash: this.busGraph.hash
    };
    
    assert.ok(packet.recipients.length > 0);
    
    const nextTransports = {};
    let packetIsForThis = false;
    
    return Promise.all(packet.recipients.map(recpId => {
      assert.ok(recpId);
      assert.ok(_.isString(recpId));
      assert.ok(packet.seenBy.length > 0);
      
      if (recpId === this.id) {
        // defer handling, since we might be receiving a message which invalidates the bus graph
        packetIsForThis = true;
        return;
      }
      
      const targetNode = this.busGraph.getNode(recpId);
      
      if (!targetNode || !targetNode.isNode()) {
        this.lostPackets++;
        return;
      }
      
      const path = this.busGraph.dijkstra.pathTo(targetNode);
      debugPackets('Path to recipient', this.id, recpId, packet.name, path && path.length);
      
      // path.length >= 3: at least source node, edge, target node
      if (!path || path.length < 3) {
        // no route -> probably not fully connected yet;
        // keep packet for a while
        const packet_ = Object.assign({}, packet);
        
        packet_.recipients = [recpId];
        packet_.seenBy = packet_.seenBy.slice(0, packet_.seenBy.length - 1);
        
        debugNetwork('No route found', this.id, recpId);
        debugPackets('Re-queueing packet', this.id, recpId, packet.name);
        assert.equal(packet_.seenBy.indexOf(this.id), -1);
        
        return this.busGraph.promiseOnce('updated').then(() => {
          return this.handleBusPacket(packet_);
        });
      }
      
      // add recipient id to recipient list for this transport
      const nextTransport = path[1].data();
      assert.ok(nextTransport);
      assert.ok(nextTransport.emit);
      
      if (nextTransports[nextTransport.id]) {
        nextTransports[nextTransport.id].recipients.push(recpId);
      } else {
        nextTransports[nextTransport.id] = {transport: nextTransport, recipients: [recpId]};
      }
    })).then(() => Promise.all(Object.keys(nextTransports).map(i => {
      const transport = nextTransports[i].transport;
      const packet_ = Object.assign({}, packet);
      packet_.recipients = nextTransports[i].recipients;

      debugPackets('Writing packet', this.id, packet_.name, transport.id, packet_.recipients.length);
      transport.msgCount++;
      return transport.emit('bus::packet', packet_);
    }))).then(() => {
      if (packetIsForThis) {
        return this.handleIncomingPacket(packet);
      }
    });
  }

  handleIncomingPacket(packet) {
    packet = this.filterInput(packet, packet.name);
    
    switch (packet.type) {
      case 'event':
        return this.handleIncomingEvent(packet);
      case 'request':
        return this.handleIncomingRequest(packet);
      case 'response':
        return this.handleIncomingResponse(packet);
      default:
        assert.fail(packet.name, 'event or request or response');
        break;
    }
  }

  handleIncomingEvent(packet) {
    debugPackets('Handle incoming event', this.id, packet.name);
    assert.ok(packet.name);
    
    return super.emit(packet.name, packet.data);
  }

  handleIncomingResponse(resp) {
    debugPackets('Handle incoming response', this.id, resp.responseTo);
    assert.ok(resp.responseTo);
    assert.ok(this.responseWaiters.get(resp.responseTo));
    
    return this.responseWaiters.get(resp.responseTo).handleResponse(resp);
  }

  handleIncomingRequest(req) {
    debugPackets('Handle incoming request', this.id, req.name, req.requestId);
    
    assert.ok(req.name);
    assert.ok(req.data);
    assert.ok(req.requestId);
    
    req.data = Object.assign({}, req.data);
    
    return super.emit(req.name, req.data, 'request').then(
      successes => ({ state: 'success', result: successes }),
      failure => ({ state: 'failure', result: failure })
    ).then(taggedResult => {
      debugPackets('Handled incoming request', this.id, req.name, req.requestId,
        taggedResult.state, taggedResult.result && taggedResult.result.length);
      
      return this.handleBusPacket(this.filterOutput({
        sender: this.id,
        seenBy: [],
        recipients: [req.sender],
        state: taggedResult.state,
        result: taggedResult.result,
        responseTo: req.requestId,
        type: 'response'
      }, 'response'));
    });
  }

  listAllIds() {
    return this.busGraph.listAllIds();
  }

  emit(name, data) {
    // do not propagate events provided by EventEmitter
    if (name === 'newListener' || name === 'removeListener') {
      return super.emit(name, data);
    } else {
      return this.emitGlobal(name, data);
    }
  }

  emitGlobal(name, data) {
    return this.emitScoped(name, data, 'global');
  }

  emitLocal(name, data) {
    return this.emitScoped(name, data, 'local');
  }

  emitImmediate(name, data) {
    return this.emitScoped(name, data, 'immediate');
  }

  emitScoped(name, data, scope) {
    assert.ok(this.initedPromise);
    
    debugEvents('Emit scoped', this.id, name, scope);
    
    const recipients = this.busGraph.expandScope(scope, name);
    
    const packet = this.filterOutput({
      sender: this.id,
      seenBy: [],
      name: name,
      data: data,
      recipients: recipients,
      type: 'event'
    }, 'event');
    
    if (recipients.length !== 0) {
      return this.handleBusPacket(packet);
    }
  }

  request(req) {
    return this.requestNearest(req);
  }
  
  requestNearest(req) {
    return this.requestScoped(req, 'nearest');
  }

  requestImmediate(req) {
    return this.requestScoped(req, 'immediate');
  }

  requestLocal(req) {
    return this.requestScoped(req, 'local');
  }

  requestGlobal(req) {
    return this.requestScoped(req, 'global');
  }

  requestScoped(req, scope) {
    assert.ok(this.initedPromise);
    
    assert.ok(req);
    
    req = Object.assign({}, req);
    assert.ok(req.name);
    assert.ok(!req.reply);
    
    const requestId = this.id + '-' + (this.curId++);
    const recipients = this.busGraph.expandScope(scope, req.name);
    
    debugEvents('Request scoped', this.id, req.name, requestId, scope, recipients.length);
    
    // scope is now array of target ids
    assert.ok(_.isArray(recipients));
    assert.equal(_.difference(recipients, this.listAllIds()).length, 0);
    
    if (recipients.length === 0) {
      const e = new Error('Nonexistent event/request type: ' + req.name);
      e.nonexistentType = true;
      return Promise.reject(e);
    }
    
    const deferred = Promise.defer();
    const responsePackets = [];
    
    this.responseWaiters.set(requestId, {
      handleResponse: responsePacket => {
        const availableRecipients = _.intersection(this.listAllIds(), recipients);
        
        debugEvents('Response packet in', this.id, scope, requestId,
          responsePackets.length, availableRecipients.length,
          recipients.length, responsePacket && responsePacket.state);
        
        if (responsePacket !== null) {
          assert.ok(responsePacket.sender);
          
          if (responsePacket.state === 'failure') {
            return deferred.reject(responsePacket.result);
          }
          
          responsePackets.push(responsePacket);
          
          assert.strictEqual(responsePacket.state, 'success');
        }
        
        // all responses in?
        if (responsePackets.length !== availableRecipients.length) {
          return; // wait until they are
        }
        
        this.responseWaiters.delete(requestId);
        
        if (scope === 'nearest') {
          // re-send in case the packet got lost (disconnect or similar)
          if (responsePackets.length === 0 ||
              responsePackets[0].result.length === 0) {
              debugEvents('Re-sending request due to missing answer', this.id, req.name, requestId, scope, recipients);
            return this.requestScoped(req, scope);
          }
          
          assert.equal(responsePackets.length, 1);
          assert.equal(responsePackets[0].result.length, 1);
          
          return deferred.resolve(responsePackets[0].result[0]);
        } else {
          return deferred.resolve(_.pluck(responsePackets, 'result'));
        }
      },
      
      unanswered: () => {
        return _.difference(recipients, _.map(responsePackets, e => e.sender));
      }
    });
    
    return this.handleBusPacket(this.filterOutput({
      sender: this.id,
      seenBy: [],
      name: req.name,
      data: req,
      requestId: requestId,
      recipients: recipients,
      type: 'request',
      singleResponse: scope === 'nearest'
    }, 'request')).then(() => deferred.promise);
  }

  stats() {
    return {
      unanswered: this.unansweredRequests.length,
      msgCount: this.msgCount,
      lostPackets: this.lostPackets,
      id: this.id,
      busGraph: this.busGraph.toJSON()
    };
  }

  get unansweredRequests() {
    return Array.from(this.responseWaiters.keys());
  }

  filterInput(packet, type) {
    return this.applyFilter(this.inputFilters, packet, type);
  }

  filterOutput(packet, type) {
    return this.applyFilter(this.outputFilters, packet, type);
  }

  applyFilter(filterList, packet, type) {
    for (let i = 0; i < filterList.length; ++i) {
      packet = filterList[i](packet, type);
      assert.ok(packet);
    }
    
    return packet;
  }

  addInputFilter(filter) {
    debugMisc('Add input filter', this.id);
    assert.ok(this.initedPromise);
    return this.inputFilters.push(filter);
  }

  addOutputFilter(filter) {
    debugMisc('Add output filter', this.id);
    assert.ok(this.initedPromise);
    return this.outputFilters.push(filter);
  }
}

exports.Bus = Bus;
