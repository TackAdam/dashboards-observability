/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import get from 'lodash/get';
import round from 'lodash/round';
import moment from 'moment';
import { v1 as uuid } from 'uuid';
import { HttpSetup } from '../../../../../../src/core/public';
import { BarOrientation } from '../../../../common/constants/shared';
import { TRACE_ANALYTICS_DATE_FORMAT } from '../../../../common/constants/trace_analytics';
import { microToMilliSec, nanoToMilliSec } from '../components/common/helper_functions';
import { SpanSearchParams } from '../components/traces/span_detail_table';
import { TraceAnalyticsMode } from '../home';
import {
  getPayloadQuery,
  getServiceBreakdownQuery,
  getSpanDetailQuery,
  getSpanFlyoutQuery,
  getSpansQuery,
  getTraceGroupPercentilesQuery,
  getTracesQuery,
  getValidTraceIdsQuery,
} from './queries/traces_queries';
import { handleDslRequest } from './request_handler';

export const handleValidTraceIds = (http: HttpSetup, DSL: any, mode: TraceAnalyticsMode) => {
  return handleDslRequest(http, {}, getValidTraceIdsQuery(DSL), mode)
    .then((response) => response.aggregations.traces.buckets.map((bucket: any) => bucket.key))
    .catch((error) => console.error(error));
};

export const handleTracesRequest = async (
  http: HttpSetup,
  DSL: any,
  timeFilterDSL: any,
  items: any,
  setItems: (items: any) => void,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string,
  sort?: any
) => {
  const binarySearch = (arr: number[], target: number) => {
    if (!arr) return Number.NaN;
    let low = 0;
    let high = arr.length;
    let mid;
    while (low < high) {
      mid = Math.floor((low + high) / 2);
      if (arr[mid] < target) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, Math.min(100, low));
  };

  // percentile should only be affected by timefilter
  const percentileRanges = await handleDslRequest(
    http,
    timeFilterDSL,
    getTraceGroupPercentilesQuery(),
    mode,
    dataSourceMDSId
  ).then((response) => {
    const map: any = {};
    response.aggregations.trace_group_name.buckets.forEach((traceGroup: any) => {
      map[traceGroup.key] = Object.values(traceGroup.percentiles.values).map((value: any) =>
        nanoToMilliSec(value)
      );
    });
    return map;
  });

  return handleDslRequest(http, DSL, getTracesQuery(mode, undefined, sort), mode, dataSourceMDSId)
    .then((response) => {
      return Promise.all(
        response.aggregations.traces.buckets.map((bucket: any) => {
          if (mode === 'data_prepper') {
            return {
              trace_id: bucket.key,
              trace_group: bucket.trace_group.buckets[0]?.key,
              latency: bucket.latency.value,
              last_updated: moment(bucket.last_updated.value).format(TRACE_ANALYTICS_DATE_FORMAT),
              error_count: bucket.error_count.doc_count,
              percentile_in_trace_group: binarySearch(
                percentileRanges[bucket.trace_group.buckets[0]?.key],
                bucket.latency.value
              ),
              actions: '#',
            };
          }
          return {
            trace_id: bucket.key,
            latency: bucket.latency.value,
            last_updated: moment(bucket.last_updated.value).format(TRACE_ANALYTICS_DATE_FORMAT),
            error_count: bucket.error_count.doc_count,
            actions: '#',
          };
        })
      );
    })
    .then((newItems) => {
      setItems(newItems);
    })
    .catch((error) => console.error(error));
};

export const handleTraceViewRequest = (
  traceId: string,
  http: HttpSetup,
  fields: {},
  setFields: (fields: any) => void,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  handleDslRequest(http, null, getTracesQuery(mode, traceId), mode, dataSourceMDSId)
    .then(async (response) => {
      const bucket = response.aggregations.traces.buckets[0];
      return {
        trace_id: bucket.key,
        trace_group: bucket.trace_group.buckets[0]?.key,
        last_updated: moment(bucket.last_updated.value).format(TRACE_ANALYTICS_DATE_FORMAT),
        user_id: 'N/A',
        latency: bucket.latency.value,
        latency_vs_benchmark: 'N/A',
        percentile_in_trace_group: 'N/A',
        error_count: bucket.error_count.doc_count,
        errors_vs_benchmark: 'N/A',
      };
    })
    .then((newFields) => {
      setFields(newFields);
    })
    .catch((error) => console.error(error));
};

// setColorMap sets serviceName to color mappings
export const handleServicesPieChartRequest = async (
  traceId: string,
  http: HttpSetup,
  setServiceBreakdownData: (serviceBreakdownData: any) => void,
  setColorMap: (colorMap: any) => void,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  const colors = [
    '#7492e7',
    '#c33d69',
    '#2ea597',
    '#8456ce',
    '#e07941',
    '#3759ce',
    '#ce567c',
    '#9469d6',
    '#4066df',
    '#da7596',
    '#a783e1',
    '#5978e3',
  ];
  const colorMap: any = {};
  let index = 0;
  await handleDslRequest(http, null, getServiceBreakdownQuery(traceId, mode), mode, dataSourceMDSId)
    .then((response) =>
      Promise.all(
        response.aggregations.service_type.buckets.map((bucket: any) => {
          colorMap[bucket.key] = colors[index++ % colors.length];
          return {
            name: bucket.key,
            color: colorMap[bucket.key],
            value: bucket.total_latency.value,
            benchmark: 0,
          };
        })
      )
    )
    .then((newItems) => {
      const latencySum = newItems.map((item) => item.value).reduce((a, b) => a + b, 0);
      return [
        {
          values: newItems.map((item) =>
            latencySum === 0 ? 100 : (item.value / latencySum) * 100
          ),
          labels: newItems.map((item) => item.name),
          benchmarks: newItems.map((item) => item.benchmark),
          marker: {
            colors: newItems.map((item) => item.color),
          },
          type: 'pie',
          textinfo: 'none',
          hovertemplate: '%{label}<br>%{value:.2f}%<extra></extra>',
        },
      ];
    })
    .then((newItems) => {
      setServiceBreakdownData(newItems);
      setColorMap(colorMap);
    })
    .catch((error) => console.error(error));
};

export const handleSpansGanttRequest = (
  traceId: string,
  http: HttpSetup,
  setSpanDetailData: (spanDetailData: any) => void,
  colorMap: any,
  spanFiltersDSL: any,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  handleDslRequest(http, spanFiltersDSL, getSpanDetailQuery(mode, traceId), mode, dataSourceMDSId)
    .then((response) => hitsToSpanDetailData(response.hits.hits, colorMap, mode))
    .then((newItems) => setSpanDetailData(newItems))
    .catch((error) => console.error(error));
};

export const handleSpansFlyoutRequest = (
  http: HttpSetup,
  spanId: string,
  setItems: (items: any) => void,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  handleDslRequest(http, null, getSpanFlyoutQuery(mode, spanId), mode, dataSourceMDSId)
    .then((response) => {
      setItems(response?.hits.hits?.[0]?._source);
    })
    .catch((error) => console.error(error));
};

const hitsToSpanDetailData = async (hits: any, colorMap: any, mode: TraceAnalyticsMode) => {
  const data: { gantt: any[]; table: any[]; ganttMaxX: number } = {
    gantt: [],
    table: [],
    ganttMaxX: 0,
  };
  if (hits.length === 0) return data;

  const minStartTime =
    mode === 'jaeger'
      ? microToMilliSec(hits[hits.length - 1].sort[0])
      : nanoToMilliSec(hits[hits.length - 1].sort[0]);
  let maxEndTime = 0;

  hits.forEach((hit: any) => {
    const startTime =
      mode === 'jaeger'
        ? microToMilliSec(hit.sort[0]) - minStartTime
        : nanoToMilliSec(hit.sort[0]) - minStartTime;
    const duration =
      mode === 'jaeger'
        ? round(microToMilliSec(hit._source.duration), 2)
        : round(nanoToMilliSec(hit._source.durationInNanos), 2);
    const serviceName =
      mode === 'jaeger'
        ? get(hit, ['_source', 'process']).serviceName
        : get(hit, ['_source', 'serviceName']);
    const name =
      mode === 'jaeger' ? get(hit, '_source.operationName') : get(hit, '_source.name');
    const error =
      mode === 'jaeger'
        ? hit._source.tag?.['error'] === true
          ? ' \u26a0 Error'
          : ''
        : hit._source['status.code'] === 2
        ? ' \u26a0 Error'
        : '';
    const uniqueLabel = `${serviceName} <br>${name} ` + uuid();
    maxEndTime = Math.max(maxEndTime, startTime + duration);

    data.table.push({
      service_name: serviceName,
      span_id: hit._source.spanID,
      latency: duration,
      vs_benchmark: 0,
      error,
      start_time: hit._source.startTime,
      end_time: hit._source.endTime,
    });
    data.gantt.push(
      {
        x: [startTime],
        y: [uniqueLabel],
        marker: {
          color: 'rgba(0, 0, 0, 0)',
        },
        width: 0.4,
        type: 'bar',
        orientation: BarOrientation.horizontal,
        hoverinfo: 'none',
        showlegend: false,
        spanId: mode === 'jaeger' ? hit._source.spanID : hit._source.spanId,
      },
      {
        x: [duration],
        y: [uniqueLabel],
        text: [error],
        textfont: { color: ['#c14125'] },
        textposition: 'outside',
        marker: {
          color: colorMap[serviceName],
        },
        width: 0.4,
        type: 'bar',
        orientation: BarOrientation.horizontal,
        hovertemplate: '%{x}<extra></extra>',
        spanId: mode === 'jaeger' ? hit._source.spanID : hit._source.spanId,
      }
    );
  });

  data.ganttMaxX = maxEndTime;
  return data;
};

export const handlePayloadRequest = (
  traceId: string,
  http: HttpSetup,
  payloadData: any,
  setPayloadData: (payloadData: any) => void,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  handleDslRequest(http, null, getPayloadQuery(mode, traceId), mode, dataSourceMDSId)
    .then((response) => setPayloadData(JSON.stringify(response.hits.hits, null, 2)))
    .catch((error) => console.error(error));
};

export const handleSpansRequest = (
  http: HttpSetup,
  setItems: (items: any) => void,
  setTotal: (total: number) => void,
  spanSearchParams: SpanSearchParams,
  DSL: any,
  mode: TraceAnalyticsMode,
  dataSourceMDSId?: string
) => {
  handleDslRequest(http, DSL, getSpansQuery(spanSearchParams), mode, dataSourceMDSId)
    .then((response) => {
      setItems(response.hits.hits.map((hit: any) => hit._source));
      setTotal(response.hits.total?.value || 0);
    })
    .catch((error) => console.error(error));
};
