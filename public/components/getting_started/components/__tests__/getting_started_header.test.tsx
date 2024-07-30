/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { configure, mount } from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import React from 'react';
import { waitFor } from '@testing-library/react';
import { GettingStartedConnectionsHeader } from '../getting_started_header';

describe('Getting Started Header Test', () => {
  configure({ adapter: new Adapter() });

  it('Renders getting started header as expected', async () => {
    const wrapper = mount(<GettingStartedConnectionsHeader />);

    await waitFor(() => {
      expect(wrapper).toMatchSnapshot();
    });
  });
});
