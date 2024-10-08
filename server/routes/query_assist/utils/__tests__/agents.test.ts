/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiResponse } from '@opensearch-project/opensearch';
import { ResponseError } from '@opensearch-project/opensearch/lib/errors';
import { CoreRouteHandlerContext } from '../../../../../../../src/core/server/core_route_handler_context';
import { coreMock, httpServerMock } from '../../../../../../../src/core/server/mocks';
import { getAgentIdByConfig, getAgentIdAndRequest } from '../agents';

describe('Agents helper functions', () => {
  const coreContext = new CoreRouteHandlerContext(
    coreMock.createInternalStart(),
    httpServerMock.createOpenSearchDashboardsRequest()
  );
  const client = coreContext.opensearch.client.asCurrentUser;
  const mockedTransport = client.transport.request as jest.Mock;

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('searches agent id by name', async () => {
    mockedTransport.mockResolvedValueOnce({
      body: {
        type: 'agent',
        configuration: { agent_id: 'agentId' },
      },
    });
    const id = await getAgentIdByConfig(client, 'test_agent');
    expect(id).toEqual('agentId');
    expect(mockedTransport.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "method": "GET",
          "path": "/_plugins/_ml/config/test_agent",
        },
      ]
    `);
  });

  it('acccepts ml_configuration key in get agent response', async () => {
    mockedTransport.mockResolvedValueOnce({
      body: {
        config_type: 'agent',
        ml_configuration: { agent_id: 'agentId' },
      },
    });
    const id = await getAgentIdByConfig(client, 'test_agent');
    expect(id).toEqual('agentId');
    expect(mockedTransport.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "method": "GET",
          "path": "/_plugins/_ml/config/test_agent",
        },
      ]
    `);
  });

  it('handles not found errors', async () => {
    mockedTransport.mockRejectedValueOnce(
      new ResponseError(({
        body: {
          error: {
            root_cause: [
              {
                type: 'status_exception',
                reason: 'Failed to find config with the provided config id: test_agent',
              },
            ],
            type: 'status_exception',
            reason: 'Failed to find config with the provided config id: test_agent',
          },
          status: 404,
        },
        statusCode: 404,
      } as unknown) as ApiResponse)
    );
    await expect(
      getAgentIdByConfig(client, 'test agent')
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Get agent 'test agent' failed, reason: {\\"error\\":{\\"root_cause\\":[{\\"type\\":\\"status_exception\\",\\"reason\\":\\"Failed to find config with the provided config id: test_agent\\"}],\\"type\\":\\"status_exception\\",\\"reason\\":\\"Failed to find config with the provided config id: test_agent\\"},\\"status\\":404}"`
    );
  });

  it('handles search errors', async () => {
    mockedTransport.mockRejectedValueOnce('request failed');
    await expect(
      getAgentIdByConfig(client, 'test agent')
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Get agent 'test agent' failed, reason: request failed"`
    );
  });

  it('searches for agent id and sends request', async () => {
    mockedTransport
      .mockResolvedValueOnce({
        body: {
          type: 'agent',
          configuration: { agent_id: 'new-id' },
        },
      })
      .mockResolvedValueOnce({
        body: { inference_results: [{ output: [{ result: 'test response' }] }] },
      });
    const response = await getAgentIdAndRequest({
      client,
      configName: 'new_agent',
      body: { parameters: { param1: 'value1' } },
    });
    expect(mockedTransport).toBeCalledWith(
      expect.objectContaining({ path: '/_plugins/_ml/agents/new-id/_execute' }),
      expect.anything()
    );
    expect(response.body.inference_results[0].output[0].result).toEqual('test response');
  });
});
