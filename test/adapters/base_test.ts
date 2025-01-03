import BaseAdapter from "../../src/adapters/base";

describe("adapters.BaseAdapter", () => {
  let adapter: BaseAdapter<any>;
  beforeEach(() => {
    adapter = new BaseAdapter();
  });

  it("should throw for non-implemented methods", () => {
    expect(() => adapter.clear()).to.Throw(Error, "Not Implemented.");
    // @ts-ignore
    expect(() => adapter.execute()).to.Throw(Error, "Not Implemented.");
    // @ts-ignore
    expect(() => adapter.get()).to.Throw(Error, "Not Implemented.");
    expect(() => adapter.list()).to.Throw(Error, "Not Implemented.");
    // @ts-ignore
    expect(() => adapter.saveLastModified()).to.Throw(
      Error,
      "Not Implemented."
    );
    expect(() => adapter.getLastModified()).to.Throw(Error, "Not Implemented.");
    // @ts-ignore
    expect(() => adapter.importBulk()).to.Throw(Error, "Not Implemented.");
    // @ts-ignore
    expect(() => adapter.loadDump()).to.Throw(Error, "Not Implemented.");
  });
});
