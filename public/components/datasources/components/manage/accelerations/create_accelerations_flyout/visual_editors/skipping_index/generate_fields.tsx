/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { EuiSmallButton, EuiConfirmModal } from '@elastic/eui';
import producer from 'immer';
import React, { useEffect, useState } from 'react';
import {
  CreateAccelerationForm,
  SkippingIndexRowType,
} from '../../../../../../../../../common/types/data_connections';
import {
  DirectQueryLoadingStatus,
  DirectQueryRequest,
} from '../../../../../../../../../common/types/explorer';
import {
  addBackticksIfNeeded,
  combineSchemaAndDatarows,
} from '../../../../../../../../../common/utils/shared';
import { useDirectQuery } from '../../../../../../../../framework/datasources/direct_query_hook';
import { validateSkippingIndexData } from '../../create/utils';

interface GenerateFieldsProps {
  accelerationFormData: CreateAccelerationForm;
  setAccelerationFormData: React.Dispatch<React.SetStateAction<CreateAccelerationForm>>;
  isSkippingtableLoading: boolean;
  setIsSkippingtableLoading: React.Dispatch<boolean>;
  dataSourceMDSId?: string;
}

export const GenerateFields = ({
  accelerationFormData,
  setAccelerationFormData,
  isSkippingtableLoading,
  setIsSkippingtableLoading,
  dataSourceMDSId,
}: GenerateFieldsProps) => {
  const [isGenerateRun, setIsGenerateRun] = useState(false);
  const { loadStatus, startLoading, stopLoading: _stopLoading, pollingResult } = useDirectQuery();
  const [replaceDefinitionModal, setReplaceDefinitionModal] = useState(<></>);

  const mapToDataTableFields = (fieldName: string) => {
    return accelerationFormData.dataTableFields.find((field) => field.fieldName === fieldName);
  };

  const loadSkippingIndexDefinition = () => {
    const combinedData = combineSchemaAndDatarows(pollingResult.schema, pollingResult.datarows);
    const skippingIndexRows = combinedData.map((field: any) => {
      return {
        ...mapToDataTableFields(field.column_name),
        accelerationMethod: field.skipping_type.split(' ')[0],
      } as SkippingIndexRowType;
    });
    setAccelerationFormData(
      producer((accData) => {
        accData.skippingIndexQueryData = skippingIndexRows;
        accData.formErrors.skippingIndexError = validateSkippingIndexData(
          accData.accelerationIndexType,
          skippingIndexRows
        );
      })
    );
  };

  useEffect(() => {
    const status = loadStatus.toLowerCase();
    if (status === DirectQueryLoadingStatus.SUCCESS) {
      loadSkippingIndexDefinition();
      setIsSkippingtableLoading(false);
    } else if (
      status === DirectQueryLoadingStatus.FAILED ||
      status === DirectQueryLoadingStatus.CANCELED
    ) {
      setIsSkippingtableLoading(false);
    }
  }, [loadStatus]);

  const runGeneration = () => {
    const requestPayload: DirectQueryRequest = {
      lang: 'sql',
      query: `ANALYZE SKIPPING INDEX ON ${addBackticksIfNeeded(
        accelerationFormData.dataSource
      )}.${addBackticksIfNeeded(accelerationFormData.database)}.${addBackticksIfNeeded(
        accelerationFormData.dataTable
      )}`,
      datasource: accelerationFormData.dataSource,
    };
    startLoading(requestPayload, dataSourceMDSId);
    setIsSkippingtableLoading(true);
    setIsGenerateRun(true);
    setReplaceDefinitionModal(<></>);
  };

  const replaceModalComponent = (
    <EuiConfirmModal
      title="Replace definitions?"
      onCancel={() => setReplaceDefinitionModal(<></>)}
      onConfirm={runGeneration}
      cancelButtonText="Cancel"
      confirmButtonText="Replace"
      defaultFocusedButton="confirm"
    >
      <p>
        Existing definitions will be removed and replaced with auto-generated definitions. Do you
        want to continue?
      </p>
    </EuiConfirmModal>
  );

  const onClickGenerate = () => {
    if (accelerationFormData.skippingIndexQueryData.length > 0) {
      setReplaceDefinitionModal(replaceModalComponent);
    } else {
      runGeneration();
    }
  };

  return (
    <>
      <EuiSmallButton onClick={onClickGenerate} isDisabled={isSkippingtableLoading}>
        {isGenerateRun ? 'Regenerate' : 'Generate'}
      </EuiSmallButton>
      {replaceDefinitionModal}
    </>
  );
};
