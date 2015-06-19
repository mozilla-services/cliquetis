"use strict";

import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon from "sinon";
import { v4 as uuid4 } from "uuid";

import Collection, { SyncResultObject } from "../src/collection";
import Api from "../src/api";

chai.use(chaiAsPromised);
chai.should();
chai.config.includeStack = true;

const TEST_BUCKET_NAME = "cliquetis-test";
const TEST_COLLECTION_NAME = "cliquetis-test";
const FAKE_SERVER_URL = "http://fake-server/v0"

describe("Collection", () => {
  var sandbox, api;
  const article = {title: "foo", url: "http://foo"};

  function testCollection() {
    api = new Api(FAKE_SERVER_URL);
    return new Collection(TEST_BUCKET_NAME, TEST_COLLECTION_NAME, api);
  }

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    return testCollection().clear();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("#open", () => {
    it("should resolve with current instance", () => {
      var articles = testCollection();

      return articles.open()
        .then(res => expect(res).eql(articles));
    });
  });

  describe("SyncResultObject", () => {
    it("should create a result object", () => {
      expect(new SyncResultObject()).to.include.keys([
        "lastModified",
        "errors",
        "created",
        "updated",
        "deleted",
        "published",
        "conflicts",
        "skipped",
      ]);
    });

    describe("set lastModified", () => {
      it("should set lastModified", () => {
        const result = new SyncResultObject();

        result.lastModified = 42;

        expect(result.lastModified).eql(42);
      });
    });

    describe("#add", () => {
      it("should add typed entries", () => {
        const result = new SyncResultObject();

        result.add("skipped", [1, 2]);
        expect(result.skipped).eql([1, 2]);
      });

      it("should concat typed entries", () => {
        const result = new SyncResultObject();

        result.add("skipped", [1, 2]);
        expect(result.skipped).eql([1, 2]);

        result.add("skipped", [3]);
        expect(result.skipped).eql([1, 2, 3]);
      });

      it("should update the ok status flag on errors", () => {
        const result = new SyncResultObject();

        result.add("errors", [1]);

        expect(result.ok).eql(false);
      });

      it("should update the ok status flag on conflicts", () => {
        const result = new SyncResultObject();

        result.add("conflicts", [1]);

        expect(result.ok).eql(false);
      });

      it("should alter non-array properties", function() {
        const result = new SyncResultObject();

        result.add("ok", false);

        expect(result.ok).eql(true);
      });
    });
  });

  describe("#saveLastModified", () => {
    var articles;

    beforeEach(() => articles = testCollection());

    it("should resolve with lastModified value", () => {
      return articles.saveLastModified(42)
        .should.eventually.become(42);
    });

    it("should save a lastModified value", () => {
      return articles.saveLastModified(42)
        .then(_ => articles.getLastModified())
        .should.eventually.become(42);
    });

    it("should update instance lastModified property value", () => {
      return articles.saveLastModified(42)
        .then(val => expect(articles.lastModified).eql(val));
    });

    it("should allow updating previous value", () => {
      return articles.saveLastModified(42)
        .then(_ => articles.saveLastModified(43))
        .then(_ => articles.getLastModified())
        .should.eventually.become(43);
    });
  });

  describe("#create", () => {
    var articles;

    beforeEach(() => articles = testCollection());

    it("should create a record and return created record data", () => {
      return articles.create(article)
        .should.eventually.have.property("data");
    });

    it("should create a record and return created record perms", () => {
      return articles.create(article)
        .should.eventually.have.property("permissions");
    });

    it("should assign an id to the created record", () => {
      return articles.create(article)
        .then(result => result.data.id)
        .should.eventually.be.a("string");
    });

    it("should not alter original record", () => {
      return articles.create(article)
        .should.eventually.not.eql(article);
    });

    it("should add record status on creation", () => {
      return articles.create(article)
        .then(res => res.data._status)
        .should.eventually.eql("created");
    });

    it("should reject if passed argument is not an object", () => {
      return articles.create(42)
        .should.eventually.be.rejectedWith(Error, /is not an object/);
    });

    it("should actually persist the record into the collection", () => {
      return articles.create(article).then(result => {
        return articles.get(result.data.id).then(res => res.data.title);
      }).should.become(article.title);
    });

    it("should prefix error encountered", () => {
      sandbox.stub(articles, "open").returns(Promise.reject("error"));
      return articles.create().should.be.rejectedWith(Error, /^create/);
    });
  });

  describe("#update", () => {
    var articles;

    beforeEach(() => articles = testCollection());

    it("should update a record", () => {
      return articles.create(article)
        .then(res => articles.get(res.data.id))
        .then(res => res.data)
        .then(existing => {
          return articles.update(
            Object.assign({}, existing, {title: "new title"}))
        })
        .then(res => articles.get(res.data.id))
        .then(res => res.data.title)
        .should.become("new title");
    });

    it("should update record status on update", () => {
      return articles.create(article)
        .then(res => res.data)
        .then(data => articles.update(Object.assign({}, data, {title: "blah"})))
        .then(res => res.data._status)
        .should.eventually.eql("updated");
    });

    it("should reject updates on a non-existent record", () => {
      return articles.update({id: "non-existent"})
        .should.be.rejectedWith(Error, /not found/);
    });

    it("should reject updates on a non-object record", () => {
      return articles.update("invalid")
        .should.be.rejectedWith(Error, /Record is not an object/);
    });

    it("should prefix error encountered", () => {
      sandbox.stub(articles, "open").returns(Promise.reject("error"));
      return articles.update().should.be.rejectedWith(Error, /^update/);
    });
  });

  describe("#get", () => {
    var articles, uuid;

    beforeEach(() => {
      articles = testCollection();
      return articles.create(article)
        .then(result => uuid = result.data.id);
    });

    it("should isolate records by bucket", () => {
      const otherbucket = new Collection('other', TEST_COLLECTION_NAME, api);
      return otherbucket.get(uuid)
        .then(res => res.data)
        .should.be.rejectedWith(Error, /not found/);
    });

    it("should retrieve a record from its id", () => {
      return articles.get(uuid)
        .then(res => res.data.title)
        .should.eventually.eql(article.title);
    });

    it("should have record status info attached", () => {
      return articles.get(uuid)
        .then(res => res.data._status)
        .should.eventually.eql("created");
    });

    it("should reject in case of record not found", () => {
      return articles.get("non-existent")
        .then(res => res.data)
        .should.be.rejectedWith(Error, /not found/);
    });

    it("should reject on virtually deleted record", () => {
      return articles.delete(uuid)
        .then(res => articles.get(uuid, {includeDeleted: true}))
        .then(res => res.data)
        .should.eventually.become({
          _status: "deleted",
          id: uuid,
          title: "foo",
          url: "http://foo",
        });
    });

    it("should support the includeDeleted option", function() {
      // body...
    });

    it("should prefix error encountered", () => {
      sandbox.stub(articles, "open").returns(Promise.reject("error"));
      return articles.get().should.be.rejectedWith(Error, /^get/);
    });
  });

  describe("#delete", () => {
    var articles, uuid;

    beforeEach(() => {
      articles = testCollection();
      return articles.create(article)
        .then(result => uuid = result.data.id);
    });

    describe("Virtual", () => {
      it("should virtually delete a record", () => {
        return articles.delete(uuid, {virtual: true})
          .then(res => articles.get(res.data.id, {includeDeleted: true}))
          .then(res => res.data._status)
          .should.eventually.eql("deleted");
      });

      it("should resolve with an already deleted record data", () => {
        return articles.delete(uuid, {virtual: true})
          .then(res => articles.delete(uuid, {virtual: true}))
          .then(res => res.data.id)
          .should.eventually.eql(uuid);
      });

      it("should reject on non-existent record", () => {
        return articles.delete("non-existent", {virtual: true})
          .then(res => res.data)
          .should.eventually.be.rejectedWith(Error, /not found/);
      });

      it("should prefix error encountered", () => {
        sandbox.stub(articles, "open").returns(Promise.reject("error"));
        return articles.delete().should.be.rejectedWith(Error, /^delete/);
      });
    });

    describe("Factual", () => {
      it("should factually delete a record", () => {
        return articles.delete(uuid, {virtual: false})
          .then(res => articles.get(res.data.id))
          .should.eventually.be.rejectedWith(Error, /not found/);
      });

      it("should resolve with deletion information", () => {
        return articles.delete(uuid, {virtual: false})
          .then(res => res.data)
          .should.eventually.eql({id: uuid});
      });

      it("should reject on non-existent record", () => {
        return articles.delete("non-existent", {virtual: false})
          .then(res => res.data)
          .should.eventually.be.rejectedWith(Error, /not found/);
      });
    });
  });

  describe("#list", () => {
    var articles;

    beforeEach(() => {
      articles = testCollection();
      return Promise.all([
        articles.create(article),
        articles.create({title: "bar", url: "http://bar"})
      ]);
    });

    it("should retrieve the list of records", () => {
      return articles.list()
        .then(res => res.data)
        .should.eventually.have.length.of(2);
    });

    it("shouldn't list virtually deleted records", () => {
      return articles.create({title: "yay"})
        .then(res => articles.delete(res.data.id))
        .then(_ => articles.list())
        .then(res => res.data)
        .should.eventually.have.length.of(2);
    });

    it("should support the includeDeleted option", () => {
      return articles.create({title: "yay"})
        .then(res => articles.delete(res.data.id))
        .then(_ => articles.list({}, {includeDeleted: true}))
        .then(res => res.data)
        .should.eventually.have.length.of(3);
    });

    it("should prefix error encountered", () => {
      sandbox.stub(articles, "open").returns(Promise.reject("error"));
      return articles.list().should.be.rejectedWith(Error, /^list/);
    });
  });

  describe("#pullChanges", () => {
    var articles, result;

    beforeEach(() => {
      articles = testCollection();
      result = new SyncResultObject();
    });

    describe("When no conflicts occured", () => {
      const localData = [
        {id: 1, title: "art1"},
        {id: 2, title: "art2"},
        {id: 4, title: "art4"},
        {id: 5, title: "art5"},
      ];
      const serverChanges = [
        {id: 2, title: "art2"}, // existing, should simply be marked as synced
        {id: 3, title: "art3"}, // to be created
        {id: 4, deleted: true}, // to be deleted
        {id: 6, deleted: true}, // remotely deleted, missing locally
      ];

      beforeEach(() => {
        sandbox.stub(Api.prototype, "fetchChangesSince").returns(
          Promise.resolve({
            lastModified: 42,
            changes: serverChanges
          }));
        return Promise.all(localData.map(fixture => {
          return articles.create(fixture, {synced: true});
        }));
      });

      it("should resolve with imported creations", () => {
        return articles.pullChanges(result)
          .then(res => res.created)
          .should.eventually.become([
            {id: 3, title: "art3", _status: "synced"}
          ]);
      });

      it("should resolve with imported updates", () => {
        return articles.pullChanges(result)
          .then(res => res.updated)
          .should.eventually.become([
            {id: 2, title: "art2", _status: "synced"}
          ]);
      });

      it("should resolve with imported deletions", () => {
        return articles.pullChanges(result)
          .then(res => res.deleted)
          .should.eventually.become([
            {id: 4}
          ]);
      });

      it("should resolve with no conflicts detected", () => {
        return articles.pullChanges(result)
          .then(res => res.conflicts)
          .should.eventually.become([]);
      });

      it("should actually import changes into the collection", () => {
        return articles.pullChanges(result)
          .then(_ => articles.list())
          .then(res => res.data)
          .should.eventually.become([
            {id: 1, title: "art1", _status: "synced"},
            {id: 2, title: "art2", _status: "synced"},
            {id: 3, title: "art3", _status: "synced"},
            {id: 5, title: "art5", _status: "synced"},
          ]);
      });

      it("should skip already locally deleted data", () => {
        return articles.create({title: "foo"})
          .then(res => articles.delete(res.data.id))
          .then(res => articles._importChange({id: res.data.id, deleted: true}))
          .then(res => res.data.title)
          .should.eventually.become("foo");
      });
    });

    describe("When a conflict occured", () => {
      var createdId;

      beforeEach(() => {
        return articles.create({title: "art2"})
          .then(res => {
            createdId = res.data.id;
            sandbox.stub(Api.prototype, "fetchChangesSince").returns(
              Promise.resolve({
                lastModified: 42,
                changes: [
                  {id: createdId, title: "art2mod"}, // will conflict with unsynced local record
                ]
              }));
          });
      });

      it("should resolve listing conflicting changes", () => {
        return articles.pullChanges(result)
          .should.eventually.become({
            ok: false,
            lastModified: 42,
            errors:    [],
            created:   [],
            updated:   [],
            deleted:   [],
            skipped:   [],
            published: [],
            conflicts: [{
              type: "incoming",
              local: {
                _status: "created",
                id: createdId,
                title: "art2",
              },
              remote: {
                id: createdId,
                title: "art2mod",
              }
            }]});
      });
    });

    describe("When a resolvable conflict occured", () => {
      var createdId;

      beforeEach(() => {
        return articles.create({title: "art2"})
          .then(res => {
            createdId = res.data.id;
            sandbox.stub(Api.prototype, "fetchChangesSince").returns(
              Promise.resolve({
                lastModified: 42,
                changes: [
                  {id: createdId, title: "art2"}, // resolvable conflict
                ]
              }));
          });
      });

      it("should resolve with solved changes", () => {
        return articles.pullChanges(result)
          .should.eventually.become({
            ok: true,
            lastModified: 42,
            errors:    [],
            created:   [],
            published: [],
            updated: [{
              id: createdId,
              title: "art2",
              _status: "synced",
            }],
            skipped: [],
            deleted: [],
            conflicts: []});
      });
    });
  });

  describe("#pushChanges", () => {
    var articles, records, result;

    beforeEach(() => {
      articles = testCollection();
      result = new SyncResultObject();
      return Promise.all([
        articles.create({title: "foo"}),
        articles.create({id: "fake-uuid", title: "bar"}, {synced: true}),
      ])
        .then(results => records = results.map(res => res.data));
    });

    it("should publish local changes to the server", () => {
      var batch = sandbox.stub(articles.api, "batch").returns(Promise.resolve({
        published: [],
        errors:    [],
        conflicts: [],
      }));
      return articles.pushChanges(result)
        .then(_ => {
          sinon.assert.calledOnce(batch);
          sinon.assert.calledWithExactly(batch,
            TEST_COLLECTION_NAME,
            sinon.match(v => v.length === 1 && v[0].title === "foo"),
            {},
            {safe: true});
        });
    });

    it("should update published records local status", () => {
      var batch = sandbox.stub(articles.api, "batch").returns(Promise.resolve({
        published: [records[0]]
      }));
      return articles.pushChanges(result)
        .then(res => res.published)
        .should.eventually.become([
          {
            _status: "synced",
            id: records[0].id,
            title: "foo",
          }
        ]);
    });

    it("should delete unsynced virtually deleted local records", () => {
      return articles.delete(records[0].id)
        .then(_ => articles.pushChanges(result))
        .then(_ => articles.get(records[0].id, {includeDeleted: true}))
        .should.be.eventually.rejectedWith(Error, /not found/);
    });

    it("should locally delete remotely deleted records", () => {
      var batch = sandbox.stub(articles.api, "batch").returns(Promise.resolve({
        published: [Object.assign({}, records[1], {deleted: true})]
      }));
      return articles.pushChanges(result)
        .then(res => res.published)
        .should.eventually.become([
          {
            id: records[1].id,
            deleted: true
          }
        ]);
    });
  });

  describe("#sync", () => {
    const fixtures = [
      {title: "art1"},
      {title: "art2"},
      {title: "art3"},
    ];
    var articles;

    beforeEach(() => {
      articles = testCollection();
      sandbox.stub(api, "batch").returns({
        errors:    [],
        published: [],
        conflicts: [],
      });
      return Promise.all(fixtures.map(fixture => articles.create(fixture)));
    });

    it("should load fixtures", () => {
      return articles.list()
        .then(res => res.data)
        .should.eventually.have.length.of(3);
    });

    it("should fetch latest changes from the server", () => {
      var fetchChangesSince = sandbox.stub(articles.api, "fetchChangesSince")
        .returns(Promise.resolve({
          lastModified: 42,
          changes: []
        }));
      return articles.sync().then(res => {
        sinon.assert.calledTwice(fetchChangesSince);
      });
    });

    it("should store latest lastModified value", () => {
      var fetchChangesSince = sandbox.stub(articles.api, "fetchChangesSince")
        .returns(Promise.resolve({
          lastModified: 42,
          changes: []
        }));
      return articles.sync().then(res => {
        expect(articles.lastModified).eql(42);
      });
    });

    it("should resolve early on pull failure", () => {
      const result = new SyncResultObject();
      result.add("conflicts", [1]);
      sandbox.stub(articles, "pullChanges").returns(Promise.resolve(result));
      return articles.sync()
        .should.eventually.become(result);
    });
  });
});
