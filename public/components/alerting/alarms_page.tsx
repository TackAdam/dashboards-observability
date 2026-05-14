/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alert Manager UI — single-datasource selection with server-side pagination.
 * Prometheus datasources are decomposed into selectable workspaces.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { EuiLink, EuiSpacer, EuiTab, EuiTabs, EuiCallOut } from '@elastic/eui';
import { toMountPoint } from '../../../../../src/plugins/opensearch_dashboards_react/public';
import { useToast } from '../common/toast';
import {
  Datasource,
  UnifiedAlertSummary,
  UnifiedRuleSummary,
} from '../../../common/types/alerting';
import { MonitorsTable } from './monitors_table';
import { CreateMonitor, MonitorFormState } from './create_monitor';
import { EditMonitor } from './create_monitor/edit_monitor';
import { AlertsDashboard } from './alerts_dashboard';
import { AlertDetailFlyout } from './alert_detail_flyout';
import { NotificationRoutingPanel } from './notification_routing_panel';
import { AlertingOpenSearchService } from './query_services/alerting_opensearch_service';
import { useMonitorMutations } from './hooks/use_monitor_mutations';
import { coreRefs } from '../../framework/core_refs';
import { setNavBreadCrumbs } from '../../../common/utils/set_nav_bread_crumbs';
import { observabilityID, observabilityTitle } from '../../../common/constants/shared';
import {
  ALERT_MANAGER_MAX_DATASOURCES_SETTING,
  ALERT_MANAGER_SELECTED_DS_STORAGE_KEY,
} from '../../../common/constants/alerting_settings';
import { transformPplFormToPayload } from '../../../common/services/alerting/form_transforms';
import type { OpenSearchFormState } from './create_monitor/create_monitor_types';

// ============================================================================
// Main Page Component
// ============================================================================

interface AlarmsPageProps {
  /** Datasources sourced from saved-object types (data-source + data-connection). */
  datasources: Datasource[];
  /** True while the initial datasource discovery is pending. */
  datasourcesLoading: boolean;
  /** Datasource names/ids to pre-select on first mount (from uiSettings). */
  defaultDatasources: string[];
  /** Cap on concurrently selected datasources (from uiSettings). */
  maxDatasources: number;
}

// Persist selection by datasource NAME. The alerting plugin reassigns `ds-N`
// ids to Prometheus datasources on every discovery pass, so caching by id
// goes stale on every server restart. Names are stable across restarts and
// match how the Routing tab's source selector resolves its stored choice.
function loadPersistedSelection(): string[] {
  try {
    const raw = window.localStorage.getItem(ALERT_MANAGER_SELECTED_DS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch (_e) {
    return [];
  }
}

function persistSelection(names: string[]) {
  try {
    window.localStorage.setItem(ALERT_MANAGER_SELECTED_DS_STORAGE_KEY, JSON.stringify(names));
  } catch (_e) {
    // localStorage can be unavailable (private mode / quota). Not fatal.
  }
}

// Resolve an array of user-supplied tokens (names or ids) against the loaded
// datasource list, returning the matched datasource ids in input order, with
// duplicates removed. Unknown tokens are dropped silently — the setting
// accepts free strings, so typos shouldn't block the page.
//
// Matching is case-insensitive and probes every stable handle we expose
// on a Datasource: id (ds-N, churns across discovery passes — accepted
// for in-session compatibility but not reliable across restarts), name,
// directQueryName (stable SQL-plugin connection name for Prom), and
// mdsId (stable saved-object id for MDS OpenSearch datasources).
function resolveDatasourceTokens(tokens: string[], datasources: Datasource[]): string[] {
  const lookup = new Map<string, string>();
  const add = (key: string | undefined, id: string) => {
    if (!key) return;
    const k = key.toLowerCase();
    if (!lookup.has(k)) lookup.set(k, id);
  };
  for (const d of datasources) {
    add(d.id, d.id);
    add(d.name, d.id);
    add(d.directQueryName, d.id);
    add(d.mdsId, d.id);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (typeof t !== 'string') continue;
    const id = lookup.get(t.trim().toLowerCase());
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

type TabId = 'alerts' | 'rules' | 'routing';

const TAB_LABELS: Record<TabId, string> = {
  alerts: 'Alerts',
  rules: 'Rules',
  routing: 'Routing',
};

// Fetch a large page from the server so child tables can paginate client-side.
// The child components (AlertsDashboard, MonitorsTable) handle their own
// page-size controls (10/20/50/100 rows per page) over this full dataset.
const DEFAULT_PAGE_SIZE = 1000;

export const AlarmsPage: React.FC<AlarmsPageProps> = ({
  datasources,
  datasourcesLoading,
  defaultDatasources,
  maxDatasources,
}) => {
  const osService = useMemo(() => new AlertingOpenSearchService(), []);
  const mutations = useMonitorMutations();
  const [activeTab, setActiveTab] = useState<TabId>('alerts');
  const [selectedDsIds, setSelectedDsIds] = useState<string[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Array<{ datasourceName: string; error: string }>>([]);

  // Paginated data — list endpoints return summary shapes.
  // Detail flyouts re-fetch the full UnifiedAlert / UnifiedRule on demand.
  const [alerts, setAlerts] = useState<UnifiedAlertSummary[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [rules, setRules] = useState<UnifiedRuleSummary[]>([]);
  const [rulesTotal, setRulesTotal] = useState(-1); // -1 = not yet loaded
  const [rulesPage, setRulesPage] = useState(1);
  const [rulesPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [deletedRuleIds, setDeletedRuleIds] = useState<Set<string>>(new Set());
  const [showCreateMonitor, setShowCreateMonitor] = useState(false);
  const [editTarget, setEditTarget] = useState<{ dsId: string; ruleId: string } | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<UnifiedAlertSummary | null>(null);
  const { setToast: addToast } = useToast();

  const visibleRules = rules.filter((r) => !deletedRuleIds.has(r.id));

  // Fires when a user tries to select past `maxDatasources`. Pops a warning
  // toast with an in-toast link to the Advanced Settings entry so they can
  // raise the cap without hunting through Management. Uses the core toasts
  // API directly (not the shared `useToast` wrapper) because the wrapper
  // only accepts plain strings — we need a React body to render the link.
  //
  // Uses `window.location.assign('/app/settings#...')` instead of
  // `navigateToApp('management', ...)` because Advanced Settings doesn't
  // support SPA redirection in a workspace context — the workspace path
  // prefix strips the hash and lands on a broken URL. See the same
  // workaround in trace_analytics helper_functions.tsx (line 70).
  const handleDatasourceCapReached = useCallback(() => {
    const toasts = coreRefs.toasts;
    const http = coreRefs.http;
    if (!toasts) return;
    // Advanced Settings renders each row with DOM id `${setting.name}-group`
    // (src/plugins/advanced_settings/.../field.tsx) and its scroll-to-hash
    // handler calls getElementById(hash) — so the hash must include the
    // `-group` suffix to scroll / highlight the target row.
    const settingsHref = `${
      http?.basePath.get() ?? ''
    }/app/settings#${ALERT_MANAGER_MAX_DATASOURCES_SETTING}-group`;
    toasts.addWarning({
      title: `Maximum ${maxDatasources} datasources can be selected`,
      text: toMountPoint(
        <>
          Adjust the <strong>Alert Manager maximum selected datasources</strong> setting in Advanced
          Settings to raise this cap.{' '}
          <EuiLink onClick={() => window.location.assign(settingsHref)}>Open setting</EuiLink>
        </>
      ),
    });
  }, [maxDatasources]);

  // ---- Breadcrumbs ----

  useEffect(() => {
    setNavBreadCrumbs(
      [{ text: observabilityTitle, href: `${observabilityID}#/` }],
      [{ text: 'Alert Manager' }, { text: TAB_LABELS[activeTab] }]
    );
  }, [activeTab]);

  // ---- Resolve initial selection once datasources are available ----
  //
  // Datasources now come from the `useDatasources` hook (parent `home.tsx`),
  // which reads them from the `data-source` + `data-connection` saved-object
  // types. This effect runs the selection-priority logic as soon as the hook
  // reports a non-loading state — initial selection must still honor the
  // same priority order as before:
  //   1. Previously-persisted names from localStorage (user's last
  //      explicit choice — wins over the admin default so refresh
  //      doesn't stomp their selection).
  //   2. `observability:alertManagerSelectedDatasources` setting
  //      (names / ids / directQueryName / mdsId). Also used as a
  //      fallthrough when localStorage exists but none of its entries
  //      resolve — e.g., the user's cached datasources were deleted.
  //   3. First discovered datasource (original behavior).
  // Always clamp to the current `maxDatasources` — so if the admin
  // lowers the cap after the user stored 5 names, we drop the overflow.
  useEffect(() => {
    if (datasourcesLoading) return;
    setSelectedDsIds((prev) => {
      if (prev.length > 0) return prev.slice(0, maxDatasources);

      const persistedNames = loadPersistedSelection();
      if (persistedNames.length > 0) {
        const resolved = resolveDatasourceTokens(persistedNames, datasources);
        if (resolved.length > 0) return resolved.slice(0, maxDatasources);
        // All cached entries were stale (datasources removed). Fall
        // through to the admin-curated setting below rather than
        // jumping straight to "first datasource" — the setting is a
        // better backup than an arbitrary pick.
      }

      if (defaultDatasources.length > 0) {
        const resolved = resolveDatasourceTokens(defaultDatasources, datasources);
        if (resolved.length > 0) return resolved.slice(0, maxDatasources);
      }

      const first = datasources[0]?.id;
      return first ? [first] : [];
    });
  }, [datasources, datasourcesLoading, defaultDatasources, maxDatasources]);

  // Persist the selection (by name) whenever it changes and we know the
  // datasource list. Names survive server restarts; ids don't.
  useEffect(() => {
    if (datasources.length === 0) return;
    const names = selectedDsIds
      .map((id) => datasources.find((d) => d.id === id)?.name)
      .filter((n): n is string => typeof n === 'string');
    persistSelection(names);
  }, [selectedDsIds, datasources]);

  // ---- Fetch data when datasource selection or page changes ----

  const fetchAlerts = useCallback(
    async (dsIds: string[], _page: number, _pageSize: number) => {
      if (dsIds.length === 0) {
        setAlerts([]);
        setAlertsTotal(0);
        return;
      }
      setDataLoading(true);
      setError(null);
      setWarnings([]);
      try {
        const res = await osService.listAlerts({ dsIds });
        setAlerts(res.results || []);
        setAlertsTotal((res.results || []).length);
        // Convert per-datasource failure entries from the progressive response
        // into the UI's warning shape.
        const failedStatuses = (res.datasourceStatus || []).filter((s) => s.status === 'error');
        if (failedStatuses.length > 0) {
          setWarnings(
            failedStatuses.map((s) => ({
              datasourceName: s.datasourceName,
              error: s.error || 'Unknown error',
            }))
          );
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to fetch alerts');
      } finally {
        setDataLoading(false);
      }
    },
    [osService]
  );

  const fetchRules = useCallback(
    async (dsIds: string[], _page: number, _pageSize: number) => {
      if (dsIds.length === 0) {
        setRules([]);
        setRulesTotal(0);
        return;
      }
      setDataLoading(true);
      setError(null);
      setWarnings([]);
      try {
        const res = await osService.listRules({ dsIds });
        setRules(res.results || []);
        setRulesTotal((res.results || []).length);
        const failedStatuses = (res.datasourceStatus || []).filter((s) => s.status === 'error');
        if (failedStatuses.length > 0) {
          setWarnings(
            failedStatuses.map((s) => ({
              datasourceName: s.datasourceName,
              error: s.error || 'Unknown error',
            }))
          );
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to fetch rules');
      } finally {
        setDataLoading(false);
      }
    },
    [osService]
  );

  // Fetch when selection or pagination changes
  useEffect(() => {
    if (selectedDsIds.length === 0) {
      setAlerts([]);
      setAlertsTotal(0);
      return;
    }
    // Fetch alerts regardless of active tab so the "Alerts (N)" tab label
    // stays in sync when the user changes filters (e.g., datasource) while
    // on a different tab. Mirrors the Rules-fetch effect below.
    fetchAlerts(selectedDsIds, alertsPage, alertsPageSize);
  }, [selectedDsIds, alertsPage, alertsPageSize, fetchAlerts]);

  useEffect(() => {
    if (selectedDsIds.length === 0) {
      setRules([]);
      setRulesTotal(0);
      return;
    }
    // Fetch rules regardless of active tab so the "Rules (N)" tab label
    // populates on initial load without requiring the user to click the tab.
    fetchRules(selectedDsIds, rulesPage, rulesPageSize);
  }, [selectedDsIds, rulesPage, rulesPageSize, fetchRules]);

  // Reset pages when datasource selection changes
  const handleDatasourceChange = useCallback((ids: string[]) => {
    setSelectedDsIds(ids);
    setAlertsPage(1);
    setRulesPage(1);
    setDeletedRuleIds(new Set());
  }, []);

  // ---- Handlers ----

  const handleAcknowledgeAlert = async (alertId: string) => {
    const alert = alerts.find((a) => a.id === alertId);
    try {
      await mutations.acknowledgeAlert(alertId, alert?.datasourceId, alert?.labels?.monitor_id);
      addToast('Alert acknowledged');
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alertId
            ? { ...a, state: 'acknowledged' as const, lastUpdated: new Date().toISOString() }
            : a
        )
      );
      // Update the flyout's selected alert inline so it stays open with fresh state
      setSelectedAlert((prev) =>
        prev && prev.id === alertId
          ? { ...prev, state: 'acknowledged' as const, lastUpdated: new Date().toISOString() }
          : prev
      );
    } catch (e: unknown) {
      addToast('Failed to acknowledge alert', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteRules = async (ids: string[]) => {
    const failed: string[] = [];
    for (const id of ids) {
      const rule = rules.find((r) => r.id === id);
      if (!rule) {
        failed.push(id);
        addToast('Failed to delete monitor', 'danger', `Monitor ${id} not found in cache`);
        continue;
      }
      try {
        await mutations.deleteMonitor(id, rule.datasourceId);
      } catch (e: unknown) {
        failed.push(id);
        addToast('Failed to delete monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    }
    const succeeded = ids.filter((id) => !failed.includes(id));
    if (succeeded.length > 0) {
      addToast(succeeded.length + ' monitor(s) deleted');
    }
    setDeletedRuleIds((prev) => {
      const next = new Set(prev);
      succeeded.forEach((id) => next.add(id));
      return next;
    });
    if (succeeded.length > 0) {
      setRulesTotal((prev) => Math.max(0, prev - succeeded.length));
    }
  };

  const handleCloneRule = async (monitor: UnifiedRuleSummary) => {
    const clone: UnifiedRuleSummary = {
      ...monitor,
      id: `clone-${Date.now()}`,
      name: `${monitor.name} (Copy)`,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      createdBy: 'current-user',
    };
    try {
      await mutations.createMonitor(
        (clone as unknown) as Record<string, unknown>,
        clone.datasourceId
      );
      addToast('Monitor cloned');
      setRules((prev) => [clone, ...prev]);
    } catch (e: unknown) {
      addToast('Failed to clone monitor', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleImportMonitors = async (configs: Array<Record<string, unknown>>) => {
    const dsId = selectedDsIds[0];
    if (!dsId) {
      addToast('Select a datasource before importing monitors', 'warning');
      return;
    }
    try {
      await mutations.importMonitors({ monitors: configs }, dsId);
      addToast('Monitors imported successfully');
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    } catch (e: unknown) {
      addToast('Failed to import monitors', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const resolveDatasourceId = (formState: MonitorFormState): string | null => {
    const dsId = formState.datasourceId || selectedDsIds[0];
    if (!dsId) {
      addToast('Select a datasource before creating a monitor', 'warning');
      return null;
    }
    return dsId;
  };

  const buildOsPayload = (form: OpenSearchFormState): Record<string, unknown> => {
    if (form.monitorType === 'ppl_monitor') {
      return transformPplFormToPayload({
        name: form.name,
        enabled: form.enabled,
        query: form.query,
        schedule: form.schedule,
        pplTriggers: form.pplTriggers,
      });
    }
    return (form as unknown) as Record<string, unknown>;
  };

  const handleCreateMonitor = async (formState: MonitorFormState) => {
    const dsId = resolveDatasourceId(formState);
    if (!dsId) return;
    try {
      const payload =
        formState.datasourceType === 'opensearch'
          ? buildOsPayload(formState)
          : ((formState as unknown) as Record<string, unknown>);
      await mutations.createMonitor(payload, dsId);
      addToast('Monitor created successfully');
      setShowCreateMonitor(false);
      // Refetch rules so the new monitor (with backend-assigned id /
      // last_update_time) shows up in the list.
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    } catch (e: unknown) {
      addToast('Failed to create monitor', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleEditMonitor = async (form: MonitorFormState, ruleId: string) => {
    const dsId = resolveDatasourceId(form);
    if (!dsId) return;
    try {
      const payload =
        form.datasourceType === 'opensearch'
          ? buildOsPayload(form)
          : ((form as unknown) as Record<string, unknown>);
      await mutations.updateMonitor(ruleId, payload, dsId);
      addToast('Monitor updated successfully');
      setEditTarget(null);
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    } catch (e: unknown) {
      addToast('Failed to update monitor', 'danger', e instanceof Error ? e.message : String(e));
    }
  };

  const handleBatchCreateMonitors = async (forms: MonitorFormState[]) => {
    let succeeded = 0;
    for (let i = 0; i < forms.length; i++) {
      const dsId = resolveDatasourceId(forms[i]);
      if (!dsId) continue;
      try {
        const payload =
          forms[i].datasourceType === 'opensearch'
            ? buildOsPayload(forms[i] as OpenSearchFormState)
            : ((forms[i] as unknown) as Record<string, unknown>);
        await mutations.createMonitor(payload, dsId);
        succeeded += 1;
      } catch (e: unknown) {
        addToast('Failed to create monitor', 'danger', e instanceof Error ? e.message : String(e));
      }
    }
    if (succeeded > 0) {
      addToast(succeeded + ' monitor(s) created successfully');
      // Refetch rather than synthesize. AI wizard keeps its own summary /
      // "Done" UX so we don't close the flyout here.
      fetchRules(selectedDsIds, rulesPage, rulesPageSize);
    }
  };

  // ---- Render ----

  const tabs = [
    { id: 'alerts' as TabId, name: `Alerts (${alertsTotal})` },
    { id: 'rules' as TabId, name: rulesTotal >= 0 ? `Rules (${rulesTotal})` : 'Rules' },
    { id: 'routing' as TabId, name: 'Routing' },
  ];

  const renderTable = () => {
    if (activeTab === 'alerts') {
      return (
        <>
          <AlertsDashboard
            alerts={alerts}
            datasources={datasources}
            loading={dataLoading}
            onViewDetail={(alert) => setSelectedAlert(alert)}
            onAcknowledge={handleAcknowledgeAlert}
            selectedDsIds={selectedDsIds}
            onDatasourceChange={handleDatasourceChange}
            maxDatasources={maxDatasources}
            onDatasourceCapReached={handleDatasourceCapReached}
          />
        </>
      );
    }
    if (activeTab === 'rules') {
      return (
        <MonitorsTable
          rules={visibleRules}
          datasources={datasources}
          loading={dataLoading}
          onDelete={handleDeleteRules}
          onClone={handleCloneRule}
          onEdit={(monitor) => setEditTarget({ dsId: monitor.datasourceId, ruleId: monitor.id })}
          onImport={handleImportMonitors}
          onCreateMonitor={(type) => {
            if (type === 'logs') {
              setShowCreateMonitor(true);
            } else if (type === 'metrics') {
              addToast(
                'Metrics monitor creation will be available in a follow-up release.',
                'primary'
              );
            }
          }}
          selectedDsIds={selectedDsIds}
          onDatasourceChange={handleDatasourceChange}
          maxDatasources={maxDatasources}
          onDatasourceCapReached={handleDatasourceCapReached}
        />
      );
    }
    if (activeTab === 'routing') {
      return <NotificationRoutingPanel datasources={datasources} />;
    }
    return null;
  };

  return (
    <div
      data-test-subj="alertManager-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <EuiTabs data-test-subj="alertManager-tabs">
        {tabs.map((t) => (
          <EuiTab
            key={t.id}
            isSelected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            data-test-subj={`alertManager-tabs-${t.id}`}
          >
            {t.name}
          </EuiTab>
        ))}
      </EuiTabs>
      <EuiSpacer size="s" />

      {/* Datasource selector removed — now integrated into filter panels */}

      {error && (
        <EuiCallOut
          title="Error loading data"
          color="danger"
          iconType="alert"
          size="s"
          style={{ marginBottom: 12 }}
        >
          <p>{error}</p>
        </EuiCallOut>
      )}

      {warnings.length > 0 && (
        <EuiCallOut
          title="Some datasources could not be reached"
          color="warning"
          iconType="alert"
          size="s"
          style={{ marginBottom: 12 }}
        >
          {warnings.map((w, i) => (
            <p key={i}>
              <strong>{w.datasourceName}</strong>: {w.error}
            </p>
          ))}
        </EuiCallOut>
      )}

      <div aria-live="polite" className="euiScreenReaderOnly">
        {`Showing ${tabs.find((t) => t.id === activeTab)?.name ?? activeTab} tab`}
      </div>
      {renderTable()}
      {showCreateMonitor && (
        <CreateMonitor
          onSave={handleCreateMonitor}
          onBatchSave={handleBatchCreateMonitors}
          onCancel={() => setShowCreateMonitor(false)}
          datasources={datasources}
          selectedDsIds={selectedDsIds}
        />
      )}
      {editTarget && (
        <EditMonitor
          dsId={editTarget.dsId}
          ruleId={editTarget.ruleId}
          onCancel={() => setEditTarget(null)}
          onSave={handleEditMonitor}
          datasources={datasources}
          selectedDsIds={selectedDsIds}
        />
      )}
      {selectedAlert && (
        <AlertDetailFlyout
          alert={selectedAlert}
          datasources={datasources}
          onClose={() => setSelectedAlert(null)}
          onAcknowledge={(id) => {
            handleAcknowledgeAlert(id);
          }}
        />
      )}
    </div>
  );
};
