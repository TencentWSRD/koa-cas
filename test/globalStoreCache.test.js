const globalStoreCache = require('../lib/globalStoreCache');
const { expect } = require('chai');

describe('globalStoreCache工作正常', function() {

  const key = 'key';
  const value = 'value';

  it('功能一切正常', function() {

    globalStoreCache.set(key, value);
    expect(globalStoreCache.contains(key)).to.be.true;
    expect(globalStoreCache.get(key)).to.equal(value);

    globalStoreCache.remove(key);
    expect(globalStoreCache.get(key)).to.be.empty;

    globalStoreCache.set(key, value);
    let all = globalStoreCache.getAll();
    expect(all[key]).to.equal(value);

    globalStoreCache.clear();
    all = globalStoreCache.getAll();
    let isEmpty = true;
    for (const i in all) {
      isEmpty = false;
      break;
    }
    expect(isEmpty).to.equal.true;
  });


});
