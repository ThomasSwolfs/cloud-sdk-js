import { createLogger, ErrorWithCause } from '@sap-cloud-sdk/util';
import { AxiosError } from 'axios';
import nock from 'nock';
import {
  mockInstanceDestinationsCall,
  mockSingleDestinationCall,
  mockSubaccountDestinationsCall,
  mockVerifyJwt
} from '../../../../../test-resources/test/test-util/destination-service-mocks';
import {
  onlyIssuerXsuaaUrl,
  mockServiceBindings
} from '../../../../../test-resources/test/test-util/environment-mocks';
import {
  basicMultipleResponse,
  certificateMultipleResponse,
  certificateSingleResponse,
  destinationName,
  samlAssertionMultipleResponse,
  samlAssertionSingleResponse
} from '../../../../../test-resources/test/test-util/example-destination-service-responses';
import {
  onlyIssuerServiceToken,
  providerServiceToken,
  subscriberServiceToken,
  subscriberUserToken
} from '../../../../../test-resources/test/test-util/mocked-access-tokens';
import { mockServiceToken } from '../../../../../test-resources/test/test-util/token-accessor-mocks';
import { wrapJwtInHeader } from '../jwt';
import * as identityService from '../identity-service';
import { DestinationConfiguration, parseDestination } from './destination';
import {
  getAllDestinationsFromDestinationService,
  getDestination
} from './destination-accessor';
import {
  DestinationFetchOptions,
  DestinationWithoutToken
} from './destination-accessor-types';
import { getDestinationFromDestinationService } from './destination-from-service';
import {
  alwaysProvider,
  alwaysSubscriber,
  DestinationSelectionStrategy,
  subscriberFirst
} from './destination-selection-strategies';
import * as destinationService from './destination-service';
import { Destination } from './destination-service-types';

const destName = 'DESTINATION';

const providerDestination: DestinationConfiguration = {
  Name: destName,
  Type: 'HTTP',
  URL: 'http://provider.com'
};

const parsedProviderDestination: DestinationWithoutToken = {
  authentication: 'NoAuthentication',
  certificates: [],
  forwardAuthToken: false,
  isTrustingAllCertificates: false,
  name: 'DESTINATION',
  originalProperties: {
    Name: 'DESTINATION',
    Type: 'HTTP',
    URL: 'http://provider.com'
  },
  type: 'HTTP',
  url: 'http://provider.com'
};

const subscriberDestination: DestinationConfiguration = {
  Name: destName,
  Type: 'HTTP',
  URL: 'http://subscriber.com'
};

const parsedSubscriberDestination: DestinationWithoutToken = {
  authentication: 'NoAuthentication',
  certificates: [],
  forwardAuthToken: false,
  isTrustingAllCertificates: false,
  name: 'DESTINATION',
  originalProperties: {
    Name: 'DESTINATION',
    Type: 'HTTP',
    URL: 'http://subscriber.com'
  },
  type: 'HTTP',
  url: 'http://subscriber.com'
};

function mockProvider(returnEmpty: boolean): nock.Scope[] {
  return [
    mockInstanceDestinationsCall(nock, [], 200, providerServiceToken),
    mockSubaccountDestinationsCall(
      nock,
      returnEmpty ? [] : [providerDestination],
      200,
      providerServiceToken
    )
  ];
}

function mockSubscriber(returnEmpty: boolean): nock.Scope[] {
  return [
    mockInstanceDestinationsCall(nock, [], 200, subscriberServiceToken),
    mockSubaccountDestinationsCall(
      nock,
      returnEmpty ? [] : [subscriberDestination],
      200,
      subscriberServiceToken
    )
  ];
}

function mockInternalErrorSubscriber(): nock.Scope[] {
  return [
    mockInstanceDestinationsCall(
      nock,
      'Internal Server Error',
      500,
      subscriberServiceToken
    ),
    mockSubaccountDestinationsCall(
      nock,
      'Internal Server Error',
      500,
      subscriberServiceToken
    )
  ];
}

interface mocks {
  subscriberMocks: nock.Scope[];
  providerMocks: nock.Scope[];
}

async function fetchDestination(
  jwt: string | undefined,
  selectionStrategy: DestinationSelectionStrategy
): Promise<Destination | null> {
  const options: DestinationFetchOptions = {
    destinationName: destName,
    selectionStrategy,
    cacheVerificationKeys: false,
    jwt
  };
  return getDestination(options);
}

function mockThingsForCombinations(
  subscriberEmpty = false,
  providerEmpty = false
): mocks {
  mockServiceBindings();
  mockVerifyJwt();
  mockServiceToken();
  return {
    subscriberMocks: mockSubscriber(subscriberEmpty),
    providerMocks: mockProvider(providerEmpty)
  };
}

function assertSubscriberNotCalledAndProviderFound(
  mocks: mocks,
  destination: Destination
) {
  mocks.subscriberMocks.forEach(mock => expect(mock.isDone()).toBe(false));
  mocks.providerMocks.forEach(mock => expect(mock.isDone()).toBe(true));
  expect(destination.url).toBe(providerDestination.URL);
}

function assertNothingCalledAndNullFound(
  mocks: mocks,
  destination: Destination | null
) {
  mocks.subscriberMocks.forEach(mock => expect(mock.isDone()).toBe(false));
  mocks.providerMocks.forEach(mock => expect(mock.isDone()).toBe(false));
  expect(destination).toBe(null);
}

describe('jwtType x selection strategy combinations. Possible values are {subscriberUserToken,providerUserToken,noUser} and {alwaysSubscriber, alwaysProvider, subscriberFirst}', () => {
  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  describe('userToken x {alwaysSubscriber,alwaysProvider,subscriberFirst}', () => {
    it('alwaysSubscriberToken: should not send a request to retrieve remote provider destination and return subscriber destination.', async () => {
      const mocks = mockThingsForCombinations();

      const actual = await fetchDestination(
        subscriberUserToken,
        alwaysSubscriber
      );
      expect(actual!.url).toBe(subscriberDestination.URL);

      mocks.subscriberMocks.forEach(mock => expect(mock.isDone()).toBe(true));
      mocks.providerMocks.forEach(mock => expect(mock.isDone()).toBe(false));
    });

    it('alwaysProvider: should not sed a request to retrieve remote subscriber destination and return provider destination', async () => {
      const mocks = mockThingsForCombinations();

      const actual = await fetchDestination(
        subscriberUserToken,
        alwaysProvider
      );
      assertSubscriberNotCalledAndProviderFound(mocks, actual!);
    });

    it('subscriberFirst: should try subscriber first (found something), provider not called and return subscriber destination', async () => {
      mockThingsForCombinations();

      const requestSpy = jest.spyOn(
        destinationService,
        'fetchSubaccountDestinations'
      );
      const actual = await fetchDestination(
        subscriberUserToken,
        subscriberFirst
      );
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenNthCalledWith(
        1,
        'https://destination.example.com',
        subscriberServiceToken,
        expect.anything()
      );
      expect(actual!.url).toBe(subscriberDestination.URL);
    });

    it('subscriberUserToken && subscriberFirst: should try subscriber first (found nothing), provider called and return provider destination', async () => {
      mockThingsForCombinations(true, false);

      const requestSpy = jest.spyOn(
        destinationService,
        'fetchSubaccountDestinations'
      );
      const actual = await fetchDestination(
        subscriberUserToken,
        subscriberFirst
      );
      expect(requestSpy).toHaveBeenCalledTimes(2);
      expect(requestSpy).toHaveBeenNthCalledWith(
        1,
        'https://destination.example.com',
        subscriberServiceToken,
        expect.anything()
      );
      expect(requestSpy).toHaveBeenNthCalledWith(
        2,
        'https://destination.example.com',
        providerServiceToken,
        expect.anything()
      );
      expect(actual!.url).toBe(providerDestination.URL);
    });
  });

  describe('no UserToken x {alwaysSubscriber,alwaysProvider,subscriberFirst}', () => {
    it('retrieves destination without specifying userJwt', async () => {
      mockServiceBindings();
      mockServiceToken();

      mockInstanceDestinationsCall(nock, [], 200, providerServiceToken);
      mockSubaccountDestinationsCall(
        nock,
        basicMultipleResponse,
        200,
        providerServiceToken
      );

      const actual = await getDestination({
        destinationName,
        cacheVerificationKeys: false
      });
      const expected = parseDestination(basicMultipleResponse[0]);
      expect(actual).toMatchObject(expected);
    });

    it('when combining `iss` and `jwt` it should fetch service token with `iss` and set user token to `jwt`', async () => {
      mockServiceBindings();
      mockServiceToken();

      jest
        .spyOn(identityService, 'exchangeToken')
        .mockImplementationOnce(() => Promise.resolve(subscriberUserToken));

      mockInstanceDestinationsCall(nock, [], 200, onlyIssuerServiceToken);
      mockSubaccountDestinationsCall(
        nock,
        samlAssertionMultipleResponse,
        200,
        onlyIssuerServiceToken
      );

      mockSingleDestinationCall(
        nock,
        samlAssertionSingleResponse,
        200,
        'FINAL-DESTINATION',
        {
          ...wrapJwtInHeader(onlyIssuerServiceToken).headers,
          'X-user-token': subscriberUserToken
        },
        { badheaders: [] }
      );

      const expected = parseDestination(samlAssertionSingleResponse);
      const actual = await getDestinationFromDestinationService({
        destinationName: 'FINAL-DESTINATION',
        iss: onlyIssuerXsuaaUrl,
        jwt: subscriberUserToken,
        cacheVerificationKeys: false
      });
      expect(actual).toMatchObject(expected);
    });

    it('is possible to get a non-principal propagation destination by only providing the subdomain (iss) instead of the whole jwt', async () => {
      mockServiceBindings();
      mockServiceToken();

      mockInstanceDestinationsCall(nock, [], 200, onlyIssuerServiceToken);
      mockSubaccountDestinationsCall(
        nock,
        certificateMultipleResponse,
        200,
        onlyIssuerServiceToken
      );

      mockSingleDestinationCall(
        nock,
        certificateSingleResponse,
        200,
        'ERNIE-UND-CERT',
        wrapJwtInHeader(onlyIssuerServiceToken).headers
      );

      const logger = createLogger({
        package: 'connectivity',
        messageContext: 'destination-accessor-service'
      });
      const debugSpy = jest.spyOn(logger, 'debug');
      const expected = parseDestination(certificateSingleResponse);
      const actual = await getDestinationFromDestinationService({
        destinationName: 'ERNIE-UND-CERT',
        iss: onlyIssuerXsuaaUrl,
        cacheVerificationKeys: false
      });
      expect(actual).toMatchObject(expected);
      expect(debugSpy).toHaveBeenCalledWith(
        'Using `iss` option instead of a full JWT to fetch a destination. No validation is performed.'
      );
    });

    it('noUserToken && alwaysSubscriber: should return null since the token does not match subscriber', async () => {
      const mocks = mockThingsForCombinations();

      const actual = await fetchDestination(undefined, alwaysSubscriber);
      assertNothingCalledAndNullFound(mocks, actual);
    });

    it('noUserToken && alwaysProvider: should not sed a request to retrieve remote subscriber destination and return provider destination.', async () => {
      const mocks = mockThingsForCombinations();

      const actual = await fetchDestination(undefined, alwaysProvider);
      assertSubscriberNotCalledAndProviderFound(mocks, actual!);
    });

    it('noUserToken && subscriberFirst: should not sed a request to retrieve remote subscriber destination and return provider destination.', async () => {
      const mocks = mockThingsForCombinations();

      const actual = await fetchDestination(undefined, subscriberFirst);
      assertSubscriberNotCalledAndProviderFound(mocks, actual!);
    });
  });
});

describe('call getAllDestinations with and without subscriber token', () => {
  beforeEach(() => {
    mockThingsForCombinations();
  });

  afterEach(() => {
    nock.cleanAll();
    jest.clearAllMocks();
  });

  it('should fetch all subscriber destinations', async () => {
    const logger = createLogger({
      package: 'connectivity',
      messageContext: 'destination-accessor'
    });
    const debugSpy = jest.spyOn(logger, 'debug');

    const allDestinations = await getAllDestinationsFromDestinationService({
      jwt: subscriberUserToken
    });

    expect(allDestinations).toEqual([parsedSubscriberDestination]);

    expect(debugSpy).toHaveBeenCalledWith(
      'Retrieving all destinations for account: "subscriber" from destination service.'
    );
    expect(debugSpy).toHaveBeenCalledWith(
      'Retrieving subaccount destination: DESTINATION.\n'
    );
  });

  it('should fetch all provider destinations when called without passing a JWT', async () => {
    const allDestinations = await getAllDestinationsFromDestinationService();
    expect(allDestinations).toEqual([parsedProviderDestination]);
  });

  it('should return an empty array if no destination are present', async () => {
    nock.cleanAll();
    jest.clearAllMocks();
    mockThingsForCombinations(true, true);

    const logger = createLogger({
      package: 'connectivity',
      messageContext: 'destination-accessor'
    });
    const debugSpy = jest.spyOn(logger, 'debug');

    const allDestinations = await getAllDestinationsFromDestinationService();
    expect(allDestinations).toEqual([]);
    expect(debugSpy).toHaveBeenCalledWith(
      "Didn't receive any destinations from destination service."
    );
  });

  it('should throw an error', async () => {
    nock.cleanAll();
    jest.clearAllMocks();

    mockServiceBindings();
    mockVerifyJwt();
    mockServiceToken();
    mockInternalErrorSubscriber();

    await getAllDestinationsFromDestinationService({
      jwt: subscriberUserToken
    }).catch((error: ErrorWithCause) => {
      const errorStatus = (error.rootCause as AxiosError).response!.status;

      expect(errorStatus).toEqual(500);
      expect(error.message).toMatch('Failed to fetch instance destinations.');
    });
  });
});
