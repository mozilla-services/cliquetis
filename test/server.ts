import { afterAll, beforeAll } from "vitest";
import { KintoProxyServer } from "kinto-node-test-server";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

let kintoServer: KintoProxyServer = null;
let fakeServer = null;

const handlers = [
  http.get("http://fake-server/v1/", () => {
    return HttpResponse.json({
      project_name: "Kinto Fakeserver",
      project_version: "fake",
      http_api_version: "fake",
      url: "http://fake-server/v1/",
      settings: {
        explicit_permissions: false,
        readonly: false,
        batch_max_requests: 25,
      },
      capabilities: {},
    });
  }),
  http.all("http://fake-server/v1/batch", async (props) => {
    const req = await props.request.json();
    const resp = req.requests.map({
      foo: "bar",
    });
    return HttpResponse.json({
      responses: resp,
    });
  }),
  http.all(/http\:\/\/fake-server\/v1\/.*/, () => {
    return HttpResponse.json({});
  }),
];

if (global.__vitest_environment__ == "node") {
  fakeServer = setupServer(...handlers);
  fakeServer.listen();
}

beforeAll(async () => {
  if (global.__vitest_environment__ != "node") {
    kintoServer = new KintoProxyServer();
    await server.startServer();
  }
});

afterAll(async () => {
  if (kintoServer) {
    await kintoServer.stopServer();
    kintoServer = null;
  }
  if (fakeServer) {
    fakeServer.close();
    fakeServer = null;
  }
});
