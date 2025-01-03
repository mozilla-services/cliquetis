import { btoa, fakeBlob } from "../test_utils";
import * as requests from "../../src/http/requests";
import { afterAll, beforeAll, describe, expect, it, vitest } from "vitest";

describe("requests module", () => {
  beforeAll(() => {
    if (typeof global !== "undefined") {
      vitest.spyOn(global, "Blob").mockImplementation(fakeBlob);
    }
  });

  afterAll(() => {
    vitest.restoreAllMocks();
  });

  describe("createRequest()", () => {
    it("should return a POST creation request", () => {
      expect(requests.createRequest("/foo", {})).eql({
        body: {
          data: undefined,
          permissions: undefined,
        },
        headers: {},
        method: "POST",
        path: "/foo",
      });
    });

    it("should return a PUT creation request when an id is provided", () => {
      expect(
        requests.createRequest("/foo", {
          data: { id: "foo" },
        })
      ).eql({
        body: {
          data: {
            id: "foo",
          },
          permissions: undefined,
        },
        headers: {},
        method: "PUT",
        path: "/foo",
      });
    });

    it("should accept a headers option", () => {
      expect(
        requests.createRequest("/foo", {}, { headers: { Foo: "Bar" } })
      ).toHaveProperty("headers.Foo", "Bar");
    });

    it("should accept a permissions option", () => {
      const permissions = { read: ["github:n1k0"] };
      expect(requests.createRequest("/foo", { permissions })).toHaveProperty(
        "body.permissions",
        permissions
      );
    });

    it("should support a safe option", () => {
      expect(
        requests.createRequest("/foo", { data: { id: "foo" } }, { safe: true })
      ).toHaveProperty("headers.If-None-Match", "*");
    });
  });

  describe("deleteRequest()", () => {
    it("should return a deletion request", () => {
      expect(requests.deleteRequest("/foo")).eql({
        headers: {},
        method: "DELETE",
        path: "/foo",
      });
    });

    it("should accept a headers option", () => {
      expect(
        requests.deleteRequest("/foo", { headers: { Foo: "Bar" } })
      ).toHaveProperty("headers.Foo", "Bar");
    });

    it("should raise for safe with no last_modified passed", () => {
      expect(() => requests.deleteRequest("/foo", { safe: true })).to.Throw(
        Error,
        /requires a last_modified/
      );
    });

    it("should support a safe option with a last_modified option", () => {
      expect(
        requests.deleteRequest("/foo", { safe: true, last_modified: 42 })
      ).toHaveProperty("headers.If-Match", '"42"');
    });
  });

  describe("updateRequest()", () => {
    it("should return a update request", () => {
      expect(
        requests.updateRequest("/foo", {
          data: { id: "foo", age: 42 },
        })
      ).eql({
        body: {
          data: { id: "foo", age: 42 },
          permissions: undefined,
        },
        headers: {},
        method: "PUT",
        path: "/foo",
      });
    });

    it("should accept a headers option", () => {
      expect(
        requests.updateRequest(
          "/foo",
          { data: { id: "foo" } },
          { headers: { Foo: "Bar" } }
        )
      ).toHaveProperty("headers.Foo", "Bar");
    });

    it("should accept a permissions option", () => {
      const permissions = { read: ["github:n1k0"] };
      expect(
        requests.updateRequest("/foo", {
          data: { id: "foo" },
          permissions,
        })
      ).toHaveProperty("body.permissions", permissions);
    });

    it("should accept a patch option", () => {
      expect(
        requests.updateRequest("/foo", { data: { id: "foo" } }, { patch: true })
      ).toHaveProperty("method", "PATCH");
    });

    it("should handle data", () => {
      expect(
        requests.updateRequest("/foo", { data: { id: "foo", a: 1 } })
      ).toHaveProperty("body.data", { id: "foo", a: 1 });
    });

    it("should support a safe option with no last_modified passed", () => {
      expect(
        requests.updateRequest(
          "/foo",
          { data: { id: "foo", a: 1 } },
          { safe: true }
        )
      ).toHaveProperty("headers.If-None-Match", "*");
    });

    it("should support a safe option with a last_modified passed", () => {
      expect(
        requests.updateRequest(
          "/foo",
          { data: { id: "foo", last_modified: 42 } },
          { safe: true }
        )
      ).toHaveProperty("headers.If-Match", '"42"');
    });
  });

  it("should accept a patch option", () => {
    expect(
      requests.updateRequest(
        "/foo",
        { data: { id: "foo", last_modified: 42 } },
        { patch: true }
      )
    ).toHaveProperty("method", "PATCH");
  });

  describe("addAttachmentRequest()", () => {
    const dataURL = "data:text/plain;name=test.txt;base64," + btoa("hola");
    it("should return a post request", () => {
      expect(requests.addAttachmentRequest("/foo", dataURL)).toHaveProperty(
        "method",
        "POST"
      );
    });

    it("should accept a headers option", () => {
      expect(
        requests.addAttachmentRequest(
          "/foo",
          dataURL,
          {},
          { headers: { Foo: "Bar" } }
        )
      ).toHaveProperty("headers.Foo", "Bar");
    });

    it("should support a safe with no last_modified passed", () => {
      expect(
        requests.addAttachmentRequest("/foo", dataURL, {}, { safe: true })
      ).toHaveProperty("headers.If-None-Match", "*");
    });

    it("should support a safe option with a last_modified option", () => {
      expect(
        requests.addAttachmentRequest(
          "/foo",
          dataURL,
          {},
          { safe: true, last_modified: 42 }
        )
      ).toHaveProperty("headers.If-Match", '"42"');
    });
  });
});
