/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenSearch form section of the Create Monitor flyout. Handles all five
 * OpenSearch monitor variants (PPL, per-query DSL, per-bucket DSL,
 * per-document DSL, cluster metrics) — showing the appropriate query input,
 * schedule, trigger, and labels/annotations UI based on `monitorType`.
 *
 * Split out of the original `create_monitor.tsx` so the flyout shell in
 * `index.tsx` stays focused on orchestration + shared form fields.
 */
import React from 'react';
import {
  EuiAccordion,
  EuiBadge,
  EuiFieldNumber,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiPanel,
  EuiSelect,
  EuiSpacer,
  EuiText,
  EuiTextArea,
  EuiTitle,
} from '@elastic/eui';
import {
  CLUSTER_METRICS_API_OPTIONS,
  OpenSearchFormState,
  OS_MONITOR_TYPE_OPTIONS,
  OS_SCHEDULE_UNIT_OPTIONS,
} from './create_monitor_types';
import { PplTriggersSection } from './sections/ppl_triggers';

// ============================================================================
// OpenSearch Form Section
// ============================================================================

export const OpenSearchFormSection: React.FC<{
  form: OpenSearchFormState;
  onUpdate: <K extends keyof OpenSearchFormState>(key: K, value: OpenSearchFormState[K]) => void;
  validationErrors: Record<string, string>;
  hasSubmitted: boolean;
}> = ({ form, onUpdate, validationErrors, hasSubmitted }) => {
  const isPPL = form.monitorType === 'ppl_monitor';
  const isClusterMetrics = form.monitorType === 'cluster_metrics_monitor';

  const handleMonitorTypeChange = (type: OpenSearchFormState['monitorType']) => {
    onUpdate('monitorType', type);
    // Reset query to appropriate default when switching between PPL and DSL types
    const wasPPL = form.monitorType === 'ppl_monitor';
    const nowPPL = type === 'ppl_monitor';
    if (wasPPL !== nowPPL && type !== 'cluster_metrics_monitor') {
      const defaultPPL =
        'source = logs-* | where @timestamp > NOW() - INTERVAL 5 MINUTE | stats count() as cnt';
      const defaultDSL =
        '{\n  "size": 0,\n  "query": {\n    "bool": {\n      "filter": [\n        { "range": { "@timestamp": { "gte": "now-5m" } } }\n      ]\n    }\n  }\n}';
      const isDefault =
        form.query.trim() === defaultPPL.trim() ||
        form.query.trim() === defaultDSL.trim() ||
        form.query.trim() === '';
      if (isDefault) {
        onUpdate('query', nowPPL ? defaultPPL : defaultDSL);
      }
    }
  };

  return (
    <>
      {/* Monitor Type */}
      <EuiFormRow label="Monitor Type" fullWidth>
        <EuiSelect
          options={OS_MONITOR_TYPE_OPTIONS}
          value={form.monitorType}
          onChange={(e) =>
            handleMonitorTypeChange(e.target.value as OpenSearchFormState['monitorType'])
          }
          fullWidth
          aria-label="Monitor type"
        />
      </EuiFormRow>

      <EuiSpacer size="m" />

      {/* Data Source — index pattern or cluster metrics API */}
      {isClusterMetrics ? (
        <EuiPanel paddingSize="m" color="subdued">
          <EuiTitle size="xs">
            <h3>Cluster Metrics API</h3>
          </EuiTitle>
          <EuiText size="xs" color="subdued">
            Select a cluster API to monitor. The monitor will call this API on the configured
            schedule and evaluate the trigger condition against the response.
          </EuiText>
          <EuiSpacer size="s" />
          <EuiFormRow label="API Type" fullWidth>
            <EuiSelect
              options={CLUSTER_METRICS_API_OPTIONS}
              value={form.clusterMetricsApiType}
              onChange={(e) => onUpdate('clusterMetricsApiType', e.target.value)}
              fullWidth
              aria-label="Cluster metrics API type"
            />
          </EuiFormRow>
          <EuiSpacer size="s" />
          <EuiFormRow
            label="Path Parameters"
            helpText="Optional path parameters, e.g. index name for CAT indices"
            fullWidth
          >
            <EuiFieldText
              placeholder="e.g. my-index-*"
              value={form.clusterMetricsPathParams}
              onChange={(e) => onUpdate('clusterMetricsPathParams', e.target.value)}
              fullWidth
              aria-label="Cluster metrics path parameters"
            />
          </EuiFormRow>
        </EuiPanel>
      ) : (
        <>
          <EuiPanel paddingSize="m" color="subdued">
            <EuiTitle size="xs">
              <h3>Data Source</h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFormRow
              label="Index Pattern"
              helpText={
                isPPL
                  ? 'Used as the PPL source if not specified in the query'
                  : 'Comma-separated index patterns, e.g. logs-*, metrics-*'
              }
              fullWidth
              isInvalid={hasSubmitted && !!validationErrors.indices}
              error={hasSubmitted ? validationErrors.indices : undefined}
            >
              <EuiFieldText
                placeholder="logs-*, metrics-*"
                value={form.indices}
                onChange={(e) => onUpdate('indices', e.target.value)}
                fullWidth
                aria-label="Index pattern"
              />
            </EuiFormRow>
          </EuiPanel>

          <EuiSpacer size="m" />

          {/* Query */}
          <EuiPanel paddingSize="m" color="subdued">
            <EuiTitle size="xs">
              <h3>Query</h3>
            </EuiTitle>
            <EuiText size="xs" color="subdued">
              {isPPL
                ? 'Piped Processing Language — pipe-delimited query syntax'
                : 'OpenSearch Query DSL (JSON)'}
            </EuiText>
            <EuiSpacer size="s" />
            <EuiTextArea
              value={form.query}
              onChange={(e) => onUpdate('query', e.target.value)}
              rows={isPPL ? 4 : 8}
              fullWidth
              placeholder={
                isPPL
                  ? 'source = logs-* | where status >= 500 | stats count() as error_count'
                  : '{ "size": 0, "query": { ... } }'
              }
              style={{ fontFamily: 'monospace', fontSize: 12 }}
              aria-label={isPPL ? 'PPL query' : 'Query DSL'}
            />
            {isPPL && (
              <>
                <EuiSpacer size="xs" />
                <EuiText size="xs" color="subdued">
                  Example:{' '}
                  <code>
                    source = logs-* | where status {'>'} 500 | stats count() as error_count by host
                  </code>
                </EuiText>
              </>
            )}
          </EuiPanel>
        </>
      )}

      <EuiSpacer size="m" />

      {/* Schedule */}
      <EuiPanel paddingSize="m" color="subdued">
        <EuiTitle size="xs">
          <h3>Schedule</h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiFlexGroup gutterSize="s">
          <EuiFlexItem>
            <EuiFormRow label="Run every" display="rowCompressed">
              <EuiFieldNumber
                value={form.schedule.interval}
                onChange={(e) =>
                  onUpdate('schedule', {
                    ...form.schedule,
                    interval: parseInt(e.target.value, 10) || 1,
                  })
                }
                min={1}
                compressed
                aria-label="Schedule interval"
              />
            </EuiFormRow>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiFormRow label="Unit" display="rowCompressed">
              <EuiSelect
                options={OS_SCHEDULE_UNIT_OPTIONS}
                value={form.schedule.unit}
                onChange={(e) =>
                  onUpdate('schedule', {
                    ...form.schedule,
                    unit: e.target.value as OpenSearchFormState['schedule']['unit'],
                  })
                }
                compressed
                aria-label="Schedule unit"
              />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>

      <EuiSpacer size="m" />

      {/* Trigger — PPL renders a multi-trigger list; DSL falls back to Painless */}
      {isPPL ? (
        <EuiPanel paddingSize="m" color="subdued">
          <PplTriggersSection
            dsId={form.datasourceId}
            triggers={form.pplTriggers}
            onChange={(next) => onUpdate('pplTriggers', next)}
            hasSubmitted={hasSubmitted}
          />
        </EuiPanel>
      ) : (
        <>
          {/* DSL Trigger */}
          <EuiPanel paddingSize="m" color="subdued">
            <EuiTitle size="xs">
              <h3>Trigger</h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFormRow label="Trigger Name" fullWidth>
              <EuiFieldText
                placeholder="e.g. Error count threshold"
                value={form.triggerName}
                onChange={(e) => onUpdate('triggerName', e.target.value)}
                fullWidth
                aria-label="Trigger name"
              />
            </EuiFormRow>
            <EuiSpacer size="s" />
            <EuiFormRow
              label="Condition (Painless script)"
              helpText="e.g. ctx.results[0].hits.total.value > 100"
              fullWidth
            >
              <EuiFieldText
                placeholder="ctx.results[0].hits.total.value > 100"
                value={form.triggerCondition}
                onChange={(e) => onUpdate('triggerCondition', e.target.value)}
                fullWidth
                style={{ fontFamily: 'monospace' }}
                aria-label="Trigger condition"
              />
            </EuiFormRow>
          </EuiPanel>

          <EuiSpacer size="m" />

          {/* DSL Action (optional) */}
          <EuiPanel paddingSize="m" color="subdued">
            <EuiAccordion
              id="os-action"
              buttonContent={
                <EuiFlexGroup alignItems="center" responsive={false} gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <strong>Action</strong>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiBadge color="hollow">Optional</EuiBadge>
                  </EuiFlexItem>
                </EuiFlexGroup>
              }
              initialIsOpen={false}
              paddingSize="none"
            >
              <EuiSpacer size="s" />
              <EuiFormRow label="Action Name">
                <EuiFieldText
                  placeholder="Notify Slack"
                  value={form.actionName}
                  onChange={(e) => onUpdate('actionName', e.target.value)}
                  aria-label="Action name"
                />
              </EuiFormRow>
              <EuiSpacer size="s" />
              <EuiFormRow label="Destination ID">
                <EuiFieldText
                  placeholder="Destination ID"
                  value={form.actionDestination}
                  onChange={(e) => onUpdate('actionDestination', e.target.value)}
                  aria-label="Destination ID"
                />
              </EuiFormRow>
              <EuiSpacer size="s" />
              <EuiFormRow label="Message Template">
                <EuiTextArea
                  placeholder="Alert: {{ctx.monitor.name}} triggered"
                  value={form.actionMessage}
                  onChange={(e) => onUpdate('actionMessage', e.target.value)}
                  rows={3}
                  aria-label="Message template"
                />
              </EuiFormRow>
            </EuiAccordion>
          </EuiPanel>
        </>
      )}
    </>
  );
};
