import endpoints from "../../src/http/endpoints";
import { describe, expect, it } from "vitest";

/** @test {endpoint} */
describe("endpoint()", () => {
  it("should provide a root endpoint", () => {
    expect(endpoints.root()).eql("/");
  });

  it("should provide a batch endpoint", () => {
    expect(endpoints.batch()).eql("/batch");
  });

  it("should provide a bucket endpoint", () => {
    expect(endpoints.bucket("foo")).eql("/buckets/foo");
  });

  it("should provide a collection endpoint", () => {
    expect(endpoints.collection("foo", "bar")).eql(
      "/buckets/foo/collections/bar"
    );
  });

  it("should provide a records endpoint", () => {
    expect(endpoints.record("foo", "bar")).eql(
      "/buckets/foo/collections/bar/records"
    );
  });

  it("should provide a record endpoint", () => {
    expect(endpoints.record("foo", "bar", "42")).eql(
      "/buckets/foo/collections/bar/records/42"
    );
  });

  it("should provide a permissions endpoint", () => {
    expect(endpoints.permissions()).eql("/permissions");
  });
});
