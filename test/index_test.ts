/* eslint dot-notation: off */
import mitt from "mitt";
import { SUPPORTED_PROTOCOL_VERSION as SPV } from "../src/http";

import Collection from "../src/collection";
import BaseAdapter from "../src/adapters/base";
import IDB from "../src/adapters/IDB";
import Kinto from "../src";

const TEST_BUCKET_NAME = "kinto-test";
const TEST_COLLECTION_NAME = "kinto-test";

/** @test {Kinto} */
describe("Kinto", () => {
  function testCollection() {
    const db = new Kinto({ bucket: TEST_BUCKET_NAME });
    return db.collection(TEST_COLLECTION_NAME);
  }

  beforeEach(() => {
    return testCollection().clear();
  });

  describe("static properties", () => {
    describe("get adapters()", () => {
      it("should provide an adapters static getter", () => {
        expect(Kinto.adapters).to.be.an("object");
      });

      it("should provide an adapters.BaseAdapter getter", () => {
        expect(Kinto.adapters.BaseAdapter).toBe(BaseAdapter);
      });

      it("should provide an adapters.IDB getter", () => {
        expect(Kinto.adapters.IDB).toBe(IDB);
      });
    });

    describe("get syncStrategy()", () => {
      it("should provide a syncStrategy static getter", () => {
        expect(Kinto.syncStrategy).eql(Collection.strategy);
      });
    });
  });

  /** @test {Kinto#constructor} */
  describe("#constructor", () => {
    it("should expose a passed events instance", () => {
      const events = mitt();
      expect(new Kinto({ events }).events).toBe(events);
    });

    it("should not create an events property if none passed", () => {
      expect(new Kinto().events).to.equal(undefined);
    });

    it("should propagate its events property to child dependencies", () => {
      const events = mitt();
      const kinto = new Kinto({ events });
      expect(kinto.collection("x").events).eql(kinto.events);
      expect(kinto.collection("x").api.events).eql(kinto.events);
      expect(kinto.collection("x").api.http.events).eql(kinto.events);
    });

    it("should propagate the requestMode option to child dependencies", () => {
      const requestMode = "no-cors";
      expect(
        new Kinto({
          requestMode,
        }).collection("x").api.http.requestMode
      ).eql(requestMode);
    });

    it("should propagate the timeout option to child dependencies", () => {
      const timeout = 1000;
      expect(
        new Kinto({
          timeout,
        }).collection("x").api.http.timeout
      ).eql(timeout);
    });

    it("should propagate the dbName option to child dependencies", () => {
      expect(
        (
          new Kinto({
            adapterOptions: { dbName: "app" },
          }).collection("x").db as IDB<any>
        ).dbName
      ).eql("app");
    });
  });

  /** @test {Kinto#collection} */
  describe("#collection()", () => {
    it("should return a Collection", () => {
      expect(testCollection()).to.be.a("object");
    });

    it("should resolve to a named collection instance", () => {
      expect(testCollection().name).eql(TEST_COLLECTION_NAME);
    });

    it("should use specified bucket name if specified", () => {
      expect(testCollection().bucket).eql(TEST_BUCKET_NAME);
    });

    it("should use default bucket if not specified", () => {
      const coll = new Kinto().collection(TEST_COLLECTION_NAME);
      expect(coll.bucket).eql("default");
    });

    it("should reject on missing collection name", () => {
      expect(() =>
        new Kinto().collection(undefined as unknown as string)
      ).to.Throw(Error, /missing collection name/);
    });

    it("should setup the Api cient using default server URL", () => {
      const db = new Kinto();
      const coll = db.collection("plop");

      expect(coll.api.remote).eql(`http://localhost:8888/${SPV}`);
    });

    it("should setup the Api cient using provided server URL", () => {
      const db = new Kinto({ remote: `http://1.2.3.4:1234/${SPV}` });
      const coll = db.collection("plop");

      expect(coll.api.remote).eql(`http://1.2.3.4:1234/${SPV}`);
    });

    it("should pass option headers to the api", () => {
      const db = new Kinto({
        remote: `http://1.2.3.4:1234/${SPV}`,
        headers: { Authorization: "Basic plop" },
      });
      const coll = db.collection("plop");

      expect(coll.api["_headers"]).eql({ Authorization: "Basic plop" });
    });

    it("should create collection using an optional adapter", () => {
      const MyAdapter = class extends BaseAdapter<any> {};
      const db = new Kinto({
        adapter: () => new MyAdapter() as unknown as BaseAdapter<any>,
      });
      const coll = db.collection("plop");

      expect(coll.db).to.be.an.instanceOf(MyAdapter);
    });

    it("should override adapter for collection if specified", () => {
      const MyAdapter = class extends BaseAdapter<any> {};
      const MyOtherAdapter = class extends BaseAdapter<any> {};
      const db = new Kinto({
        adapter: () => new MyAdapter() as unknown as BaseAdapter<any>,
      });
      const coll = db.collection("plop", {
        adapter: () => new MyOtherAdapter() as unknown as BaseAdapter<any>,
      });
      expect(coll.db).to.be.an.instanceOf(MyOtherAdapter);
    });

    it("should make the collection's remoteTransformers default to []", () => {
      const db = new Kinto();
      const coll = db.collection("plop");

      expect(coll.remoteTransformers).to.deep.equal([]);
    });

    it("should set collection's remoteTransformers", () => {
      const transformer = { encode() {}, decode() {} };
      const db = new Kinto();
      const options = { remoteTransformers: [transformer] };
      const coll = db.collection("plop", options);

      expect(coll.remoteTransformers).to.deep.equal(options.remoteTransformers);
    });
  });
});
