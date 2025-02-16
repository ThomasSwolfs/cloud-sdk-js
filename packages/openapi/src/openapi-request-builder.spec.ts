import nock from 'nock';
import * as httpClient from '@sap-cloud-sdk/http-client';
import {
  HttpDestination,
  parseDestination,
  sanitizeDestination
} from '@sap-cloud-sdk/connectivity';
import { wrapJwtInHeader } from '@sap-cloud-sdk/connectivity/internal';
import { encodeTypedClientRequest } from '@sap-cloud-sdk/http-client/dist/http-client';
import { retry, timeout } from '@sap-cloud-sdk/resilience';
import {
  expectAllMocksUsed,
  certificateMultipleResponse,
  certificateSingleResponse,
  mockInstanceDestinationsCall,
  mockServiceBindings,
  mockSingleDestinationCall,
  mockSubaccountDestinationsCall,
  onlyIssuerServiceToken,
  onlyIssuerXsuaaUrl,
  providerXsuaaUrl,
  providerServiceToken
} from '../../../test-resources/test/test-util';
import { OpenApiRequestBuilder } from './openapi-request-builder';

const destination: HttpDestination = {
  url: 'http://example.com'
};

const httpSpy = jest.spyOn(httpClient, 'executeHttpRequest');
const dummyResponse = 'dummy response';

describe('openapi-request-builder', () => {
  beforeEach(() => {
    nock(destination.url).get(/.*/).reply(200, dummyResponse);
    nock(destination.url).post(/.*/).reply(200);
  });
  afterEach(() => {
    httpSpy.mockClear();
  });

  it('executeRaw executes a request without parameters', async () => {
    const requestBuilder = new OpenApiRequestBuilder('get', '/test');
    const response = await requestBuilder.executeRaw(destination);
    expect(httpSpy).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'get',
        middleware: [],
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        data: undefined,
        parameterEncoder: encodeTypedClientRequest
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toBe(dummyResponse);
  });

  it('executeRaw executes a request with query parameters', async () => {
    const requestBuilder = new OpenApiRequestBuilder('get', '/test', {
      queryParameters: {
        limit: 100
      }
    });
    const response = await requestBuilder.executeRaw(destination);
    expect(httpClient.executeHttpRequest).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'get',
        middleware: [],
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: { limit: 100 } },
        data: undefined,
        parameterEncoder: encodeTypedClientRequest
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toBe(dummyResponse);
  });

  it('executeRaw executes a request with body', async () => {
    const requestBuilder = new OpenApiRequestBuilder('post', '/test', {
      body: {
        limit: 100
      }
    });
    await requestBuilder.executeRaw(destination);
    expect(httpClient.executeHttpRequest).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'post',
        middleware: [expect.any(Function)], // this is the csrf token middleware
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        parameterEncoder: encodeTypedClientRequest,
        data: {
          limit: 100
        }
      },
      { fetchCsrfToken: true }
    );
  });

  it('executes a request using the timeout', async () => {
    const delayInResponse = 10;
    const slowDestination = { url: 'https://example.com' };
    nock(slowDestination.url, {})
      .get('/with-delay')
      .times(2)
      .delay(delayInResponse)
      .reply(200);

    const timeoutBelowDelay = () =>
      new OpenApiRequestBuilder('get', '/with-delay')
        .middleware([timeout(delayInResponse * 0.5)])
        .execute(slowDestination);

    await expect(timeoutBelowDelay()).rejects.toThrow(
      'Request to URL: https://example.com ran into a timeout after 5ms.'
    );

    const timeoutAboveDelay = () =>
      new OpenApiRequestBuilder('get', '/with-delay')
        .middleware(timeout(delayInResponse * 10))
        .execute(slowDestination);
    await expect(timeoutAboveDelay()).resolves.not.toThrow();
  });

  it('executes a request using retry and timeout (using spread middleware overload)', async () => {
    const delayInResponse = 10;
    const slowDestination = { url: 'https://example.com' };
    nock(slowDestination.url, {})
      .get('/with-delay')
      .delay(delayInResponse)
      .reply(503)
      .get('/with-delay')
      .delay(delayInResponse)
      .reply(200);

    const timeoutAboveDelay = () =>
      new OpenApiRequestBuilder('get', '/with-delay')
        .middleware(retry(2), timeout(100))
        .execute(slowDestination);
    await expect(timeoutAboveDelay()).resolves.not.toThrow();
  }, 10000);

  it('executes a request using retry and timeout (using array middleware overload)', async () => {
    const delayInResponse = 10;
    const slowDestination = { url: 'https://example.com' };
    nock(slowDestination.url, {})
      .get('/with-delay')
      .delay(delayInResponse)
      .reply(503)
      .get('/with-delay')
      .delay(delayInResponse)
      .reply(200);

    const timeoutAboveDelay = () =>
      new OpenApiRequestBuilder('get', '/with-delay')
        .middleware([retry(2), timeout(100)])
        .execute(slowDestination);
    await expect(timeoutAboveDelay()).resolves.not.toThrow();
  });

  it('executes a request using the (iss) to build a token instead of a user JWT', async () => {
    mockServiceBindings();

    const nocks = [
      nock(onlyIssuerXsuaaUrl)
        .post('/oauth/token')
        .times(1)
        .reply(200, { access_token: onlyIssuerServiceToken }),
      nock(providerXsuaaUrl)
        .post('/oauth/token')
        .times(1)
        .reply(200, { access_token: providerServiceToken }),
      mockInstanceDestinationsCall(nock, [], 200, onlyIssuerServiceToken),
      mockSubaccountDestinationsCall(
        nock,
        certificateMultipleResponse,
        200,
        onlyIssuerServiceToken
      ),
      mockSingleDestinationCall(
        nock,
        certificateSingleResponse,
        200,
        'ERNIE-UND-CERT',
        wrapJwtInHeader(onlyIssuerServiceToken).headers
      ),
      nock(certificateSingleResponse.destinationConfiguration.URL!)
        .get(/.*/)
        .reply(200, 'iss token used on the way')
    ];
    const requestBuilder = new OpenApiRequestBuilder('get', '/test', {
      body: {
        limit: 100
      }
    });
    const response = await requestBuilder.executeRaw({
      destinationName: 'ERNIE-UND-CERT',
      iss: onlyIssuerXsuaaUrl
    });
    expectAllMocksUsed(nocks);
    expect(httpSpy).toHaveBeenLastCalledWith(
      sanitizeDestination(parseDestination(certificateSingleResponse)),
      {
        method: 'get',
        middleware: [],
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        parameterEncoder: encodeTypedClientRequest,
        data: {
          limit: 100
        }
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toBe('iss token used on the way');
  });

  it('addCustomHeaders', async () => {
    const requestBuilder = new OpenApiRequestBuilder('get', '/test');
    const destinationWithAuth = {
      ...destination,
      headers: { authorization: 'destAuth' }
    };
    const response = await requestBuilder
      .addCustomHeaders({ authorization: 'custom-header' })
      .executeRaw(destinationWithAuth);
    expect(httpSpy).toHaveBeenCalledWith(
      sanitizeDestination(destinationWithAuth),
      {
        method: 'get',
        middleware: [],
        url: '/test',
        parameterEncoder: encodeTypedClientRequest,
        headers: {
          custom: { authorization: 'custom-header' },
          requestConfig: {}
        },
        params: { requestConfig: {} },
        data: undefined
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toBe(dummyResponse);
  });

  it('encodes path parameters', async () => {
    const requestBuilder = new OpenApiRequestBuilder('get', '/test/{id}', {
      pathParameters: { id: '^test' }
    });
    const response = await requestBuilder.executeRaw(destination);
    expect(httpSpy).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'get',
        middleware: [],
        url: '/test/%5Etest',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        parameterEncoder: encodeTypedClientRequest,
        data: undefined
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toBe(dummyResponse);
  });

  it('addCustomRequestConfig', async () => {
    const requestBuilder = new OpenApiRequestBuilder('get', '/test');
    const response = await requestBuilder
      .addCustomRequestConfiguration({ responseType: 'arraybuffer' })
      .executeRaw(destination);
    expect(httpClient.executeHttpRequest).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'get',
        middleware: [],
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        data: undefined,
        parameterEncoder: encodeTypedClientRequest,
        responseType: 'arraybuffer'
      },
      { fetchCsrfToken: false }
    );
    expect(response.data).toEqual(Buffer.from(dummyResponse, 'utf-8'));
  });

  it('will not fetch csrf token when skipping the csrf token request', async () => {
    const requestBuilder = new OpenApiRequestBuilder(
      'post',
      '/test'
    ).skipCsrfTokenFetching();
    await requestBuilder.executeRaw(destination);
    expect(httpSpy).toHaveBeenCalledWith(
      sanitizeDestination(destination),
      {
        method: 'post',
        middleware: [],
        url: '/test',
        headers: { requestConfig: {} },
        params: { requestConfig: {} },
        parameterEncoder: encodeTypedClientRequest,
        data: undefined
      },
      { fetchCsrfToken: false }
    );
  });

  describe('requestConfig', () => {
    it('should overwrite default request config with filtered custom request config', async () => {
      const requestBuilder = new OpenApiRequestBuilder('get', '/test');
      requestBuilder.addCustomRequestConfiguration({
        method: 'merge'
      });
      const requestConfig = await requestBuilder['requestConfig']();
      expect(requestConfig['method']).toBe('merge');
    });
  });
});
