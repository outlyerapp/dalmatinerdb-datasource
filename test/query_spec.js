/*global describe, it, beforeEach*/

import _ from "lodash";
import chai from 'chai';
import sinon from 'sinon';
import source_map from 'source-map-support';
import {DalmatinerQuery} from "./query";

source_map.install({handleUncaughtExceptions: false});


describe('DalmatinerQuery', function() {
  var expect = chai.expect,
      query;

  beforeEach(function() {
    query = new DalmatinerQuery();
  });

  describe('#equals', function() {

    it('should build a condition with name-space', function() {
      var c = DalmatinerQuery.equals(['dl', 'source'], 'agent1');
      expect('' + c).to.be.equal("dl:'source' = 'agent1'");
    });

    it('should build a condition without name-space', function() {
      var c = DalmatinerQuery.equals(['', 'custom'], 'some-value');
      expect('' + c).to.be.equal("'custom' = 'some-value'");
    });

    it('should build a condition that can be and-ed', function() {
      var c = DalmatinerQuery.equals(['label', 'production'], '')
            .and(DalmatinerQuery.equals(['label', 'web'], ''));
      expect('' + c).to.be.equal("label:'production' = '' AND label:'web' = ''");
    });

    it('should build a condition that can be or-ed', function() {
      var c = DalmatinerQuery.equals(['label', 'production'], '')
            .or(DalmatinerQuery.equals(['label', 'web'], ''));
      expect('' + c).to.be.equal("label:'production' = '' OR label:'web' = ''");
    });
  });

  describe('#not-equals', function() {

    it('should build a condition with name-space', function() {
      var c = DalmatinerQuery.notEquals(['dl', 'source'], 'agent1');
      expect('' + c).to.be.equal("dl:'source' != 'agent1'");
    });

    it('should build a condition without name-space', function() {
      var c = DalmatinerQuery.notEquals(['', 'custom'], 'some-value');
      expect('' + c).to.be.equal("'custom' != 'some-value'");
    });

    it('should build a condition that can be and-ed', function() {
      var c = DalmatinerQuery.notEquals(['label', 'production'], '')
            .and(DalmatinerQuery.notEquals(['label', 'web'], ''));
      expect('' + c).to.be.equal("label:'production' != '' AND label:'web' != ''");
    });

    it('should build a condition that can be or-ed', function() {
      var c = DalmatinerQuery.notEquals(['label', 'production'], '')
            .or(DalmatinerQuery.notEquals(['label', 'web'], ''));
      expect('' + c).to.be.equal("label:'production' != '' OR label:'web' != ''");
    });
  });

  describe('#wildcards', function() {

    it('should not quote wildcards', function() {
      query.from('myorg')
        .select(['base', 'cpu', '*']);
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.* FROM 'myorg'");
    });

    it('should workaround limitations on wildcard + dimensions', function() {
      var c = DalmatinerQuery.equals(['dl', 'source'], 'finger');
      query.from('myorg')
        .select(['base', 'cpu', '*'])
        .where(c);

      expect(query.toUserString()).to.be
        .equal("SELECT 'finger'.'base'.'cpu'.* BUCKET 'fi'");
    });
  });

  describe('#present', function() {

    it('should build a condition checking presence of a tag', function() {
      var c = DalmatinerQuery.present(['label', 'production']);
      expect('' + c).to.be.equal("label:'production'");
    });
  });

  describe('#select', function() {

    it('should be enough for simple query when combined with from statement', function() {
      query.from('myorg')
        .select(['base', 'cpu', 'system']);
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'myorg'");
    });

    it('should create multi part query when called multiple times', function() {
      query.from('myorg')
        .select(['base', 'cpu', 'system'])
        .select(['base', 'cpu', 'user']);
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'myorg', 'base'.'cpu'.'user' FROM 'myorg'");
    });

    it('should create selector for most recent collection', function() {
      query.from('first-org')
        .select(['base', 'cpu', 'system'])
        .from('second-org')
        .select(['base', 'cpu', 'user']);
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'first-org', 'base'.'cpu'.'user' FROM 'second-org'");
    });

  });

  describe('#apply', function() {

    it('should apply function on active selection', function() {
      query.from('myorg')
        .select(['base', 'network', 'eth0', 'sent'])
        .apply('derivate');
      expect(query.toUserString()).to.be
        .equal("SELECT derivate('base'.'network'.'eth0'.'sent' FROM 'myorg')");
    });

    it('should support function with extra argument', function() {
      query.from('myorg')
        .select(['base', 'cpu'])
        .apply('avg', ['30s']);
      expect(query.toUserString()).to.be
        .equal("SELECT avg('base'.'cpu' FROM 'myorg', 30s)");
    });

    it('should expand variables in function arguments', function() {
      query.from('myorg')
        .select(['base', 'cpu'])
        .with('interval', '30s')
        .apply('avg', ['$interval']);
      expect(query.toUserString()).to.be
        .equal("SELECT avg('base'.'cpu' FROM 'myorg', 30s)");
    });

    it('should fail when variable is not defined', function() {
      query.from('myorg')
        .select(['base', 'cpu'])
        .apply('avg', ['$interval']);
      expect(query.toUserString).to.throw(Error);
    });

    it('should allow for function chaining', function() {
      query.from('myorg')
        .select(['base', 'network', 'eth0', 'sent'])
        .apply('derivate')
        .apply('sum', ['30s']);
      expect(query.toUserString()).to.be
        .equal("SELECT sum(derivate('base'.'network'.'eth0'.'sent' FROM 'myorg'), 30s)");
    });

    it('should be applied only to last selection', function() {
      query.from('myorg')
        .select(['base', 'cpu', 'user'])
        .select(['base', 'cpu', 'system'])
        .apply('max', [])
        .select(['base', 'cpu', 'idle'])
        .apply('min', []);
      expect(query.toUserString()).to.be.equal(
        "SELECT 'base'.'cpu'.'user' FROM 'myorg', " +
          "max('base'.'cpu'.'system' FROM 'myorg'), " +
          "min('base'.'cpu'.'idle' FROM 'myorg')"
      );
    });

  });

  describe('#apply-series', function() {
    let hidden = true;

    it('should not allow references to non-existent series', function() {
      let q = query.from('myorg')
                   .select(['base', 'network', 'eth0', 'sent'], 'B');
      expect(() => { q.applyToSeries('avg', ['#A']) }).to.throw(Error);
    });

    it('should allow references to selectors', function() {
      query.from('org')
        .select(['eth0', 'sent'], 'A')
        .setVisibility(hidden)
        .select(['lo', 'sent'], 'B')
        .applyToSeries('sum', ['#A'])
        .aliasBy('total');

      expect(query.toUserString()).to.be
        .equal("SELECT sum('lo'.'sent' FROM 'org', 'eth0'.'sent' FROM 'org') AS total")
    });

    it('should allow references to function projections', function() {
      query.from('org')
        .select(['eth0', 'sent'], 'A')
        .apply('derivate')
        .setVisibility(hidden)
        .select(['lo', 'sent'], 'B')
        .apply('derivate')
        .applyToSeries('sum', ['#A'])
        .aliasBy('total');

      expect(query.toUserString()).to.be
        .equal("SELECT sum(derivate('lo'.'sent' FROM 'org'), derivate('eth0'.'sent' FROM 'org')) AS total")
    });
  });

  describe('#alias', function() {

    it('should alias simple selectors with from statement', function() {
      query.from('myorg')
        .select(['base', 'cpu', 'system'])
        .aliasBy('$1');
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'myorg' AS $1");
    });

    it('should alias chained functions', function() {
      query.from('myorg')
        .select(['base', 'network', 'eth0', 'sent'])
        .apply('derivate')
        .apply('sum', ['30s'])
        .aliasBy('$1');
      expect(query.toUserString()).to.be
        .equal("SELECT sum(derivate('base'.'network'.'eth0'.'sent' FROM 'myorg'), 30s) AS $1");
    });

    it('should only alias selector for most recent collection', function() {
      query.from('first-org')
        .select(['base', 'cpu', 'system'])
        .from('second-org')
        .select(['base', 'cpu', 'user'])
        .aliasBy('$1');
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'first-org', 'base'.'cpu'.'user' FROM 'second-org' AS $1");
    });

  });

  describe('#timeshift', function() {

    it('should timeshift simple selectors with from statement', function() {
      query.from('myorg')
        .select(['base', 'cpu', 'system'])
        .shiftBy('1h');
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'myorg' SHIFT BY 1h");
    });

    it('should timeshift chained functions', function() {
      query.from('myorg')
        .select(['base', 'network', 'eth0', 'sent'])
        .apply('derivate')
        .apply('sum', ['30s'])
        .shiftBy('1h');
      expect(query.toUserString()).to.be
        .equal("SELECT sum(derivate('base'.'network'.'eth0'.'sent' FROM 'myorg'), 30s) SHIFT BY 1h");
    });

    it('should only timeshift selector for most recent collection', function() {
      query.from('first-org')
        .select(['base', 'cpu', 'system'])
        .shiftBy('1h')
        .from('second-org')
        .select(['base', 'cpu', 'user'])
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'first-org' SHIFT BY 1h, 'base'.'cpu'.'user' FROM 'second-org'");
    });

    it('should timeshift selectors with an alias applied', function() {
      query.from('first-org')
        .select(['base', 'cpu', 'system'])
        .shiftBy('1h')
        .aliasBy('$1');
      expect(query.toUserString()).to.be
        .equal("SELECT 'base'.'cpu'.'system' FROM 'first-org' AS $1 SHIFT BY 1h");
    });
  });

});
