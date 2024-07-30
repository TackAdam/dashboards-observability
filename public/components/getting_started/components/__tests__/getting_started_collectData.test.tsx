/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { mount, configure } from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import { act } from 'react-dom/test-utils';
import { waitFor } from '@testing-library/react';
import { CollectAndShipData } from '../getting_started_collectData';

configure({ adapter: new Adapter() });

describe('Getting Started Collect Data Test', () => {
  const mockOnToggle = jest.fn();
  const mockOnMoveToQueryData = jest.fn();
  const mockOnSelectSource = jest.fn();
  const mockOnCardSelectionChange = jest.fn();

  const props = {
    isOpen: true,
    onToggle: mockOnToggle,
    selectedTechnology: '',
    onMoveToQueryData: mockOnMoveToQueryData,
    onSelectSource: mockOnSelectSource,
    onCardSelectionChange: mockOnCardSelectionChange,
  };

  it('Renders correctly', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    expect(wrapper).toMatchSnapshot();
  });

  it('Renders collection method options', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    expect(wrapper.find('EuiCheckableCard')).toHaveLength(3);
    expect(wrapper.find('EuiCheckableCard').at(0).text()).toContain('Configure collectors');
    expect(wrapper.find('EuiCheckableCard').at(1).text()).toContain('Upload a file CSV');
    expect(wrapper.find('EuiCheckableCard').at(2).text()).toContain('Use a sample dataset');
  });

  it('Handles Configure collectors option', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    const configureCollectorsOption = wrapper.find('EuiCheckableCard').at(0).find('input');

    act(() => {
      configureCollectorsOption.simulate('change', { target: { checked: true } });
    });

    await waitFor(() => {
      wrapper.update();
      expect(wrapper.find('EuiSelectable')).toHaveLength(1);
      expect(wrapper.find('EuiSelectable').props().options).toEqual([
        { label: 'Open Telemetry (structured)', value: 'otel' },
        { label: 'Nginx (structured)', value: 'nginx' },
        { label: 'Java (unstructured)', value: 'java' },
        { label: 'Python (unstructured)', value: 'python' },
        { label: 'Golang (unstructured)', value: 'golang' },
      ]);
    });
  });

  it('Handles Upload a file CSV option', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    const uploadFileOption = wrapper.find('EuiCheckableCard').at(1).find('input');

    act(() => {
      uploadFileOption.simulate('change', { target: { checked: true } });
    });

    await waitFor(() => {
      wrapper.update();
      expect(wrapper.find('EuiSelectable')).toHaveLength(1);
      expect(wrapper.find('EuiSelectable').props().options).toEqual([
        { label: 'Fluent Bit', value: 'csv' },
      ]);
    });
  });

  it('Handles Use a sample dataset option', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    const sampleDatasetOption = wrapper.find('EuiCheckableCard').at(2).find('input');

    act(() => {
      sampleDatasetOption.simulate('change', { target: { checked: true } });
    });

    await waitFor(() => {
      wrapper.update();
      expect(wrapper.find('IntegrationCards')).toHaveLength(1);
    });
  });

  it('Selecting otel', async () => {
    const wrapper = mount(<CollectAndShipData {...props} />);
    const configureCollectorsOption = wrapper.find('EuiCheckableCard').at(0).find('input');

    act(() => {
      configureCollectorsOption.simulate('change', { target: { checked: true } });
    });

    await waitFor(() => {
      wrapper.update();
      expect(wrapper.find('EuiSelectable')).toHaveLength(1);
      expect(wrapper.find('EuiSelectable').props().options).toEqual([
        { label: 'Open Telemetry (structured)', value: 'otel' },
        { label: 'Nginx (structured)', value: 'nginx' },
        { label: 'Java (unstructured)', value: 'java' },
        { label: 'Python (unstructured)', value: 'python' },
        { label: 'Golang (unstructured)', value: 'golang' },
      ]);
    });

    const selectableProps = wrapper.find('EuiSelectable').props();
    const selectedOption = selectableProps.options?.find((opt) => opt.value === 'otel');

    if (selectableProps.onChange && selectedOption) {
      act(() => {
        selectableProps.onChange([{ ...selectedOption, checked: 'on' }] as any);
      });
    }

    await waitFor(() => {
      wrapper.update();
      expect(mockOnSelectSource).toHaveBeenCalledWith('otel');
      expect(wrapper.find('EuiTabbedContent')).toHaveLength(1);
      expect(wrapper.find('EuiSteps')).toHaveLength(1);
      expect(wrapper.find('EuiTitle').at(6).text()).toContain('Schema');
      expect(wrapper.find('EuiTitle').at(10).text()).toContain('Index Patterns');
    });
  });
});
