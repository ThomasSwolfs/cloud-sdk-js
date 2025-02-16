import moment from 'moment';
import { testEntityApi } from '../../test/test-util';

describe('orderable', () => {
  describe('DateTime and DateTimeOffset fields', () => {
    const dateFilterValue = moment(1425427200000);
    const datetimeFieldName = 'DateTimeProperty';
    const datetimeoffsetFieldName = 'DateTimeOffSetProperty';

    it('should create filter for type DateTimeOffset by passing moment() ', () => {
      const filter = testEntityApi.schema.DATE_TIME_OFF_SET_PROPERTY.equals(
        moment()
      );
      expect(moment.isMoment(filter.value)).toBe(true);
    });

    it('should create filter for equals for type Edm.DateTime', () => {
      const filter = testEntityApi.schema.DATE_TIME_PROPERTY.equals(
        moment(1425427200000)
      );
      expect(filter.field).toBe(datetimeFieldName);
      expect(filter.operator).toBe('eq');
      expect(filter.value).toEqual(dateFilterValue);
    });

    it('should create filter for equals for type Edm.DateTimeOffset', () => {
      const filter = testEntityApi.schema.DATE_TIME_OFF_SET_PROPERTY.equals(
        moment(1425427200000)
      );
      expect(filter.field).toBe(datetimeoffsetFieldName);
      expect(filter.operator).toBe('eq');
      expect(filter.value).toEqual(dateFilterValue);
    });
  });
});
