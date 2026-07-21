import request from './index';

const MOCK_API_PREFIX = '/mock-api/clause-comparison';

/**
 * Upload old and new PDF files and compare clauses.
 * @param {FormData} data
 * @returns {Promise<any>}
 */
export function uploadPdfsAndCompareClauses(data) {
  // return request({
  //   url: '/clause-comparison/compare',
  //   method: 'post',
  //   data: data,
  //   headers: {
  //     'Content-Type': 'multipart/form-data'
  //   }
  // });

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        code: 200,
        message: '条項比較が完了しました',
        data: [
          {
            id: '1.1',
            oldContent: 'This specification covers pyrometric requirements for thermal processing equipment used for heat treatment.',
            newContent: 'This specification covers pyrometric requirements for equipment used for the thermal processing of metallic materials. Specifically, it covers temperature sensors.',
            diffs: [
              { type: 'unchanged', value: 'This specification covers pyrometric requirements for ' },
              { type: 'removed', value: 'thermal processing equipment used for heat treatment.' },
              { type: 'added', value: 'equipment used for the thermal processing of metallic materials. Specifically, it covers temperature sensors.' }
            ],
            isNew: false,
            attachments: ['http://example.com/image1.png', 'http://example.com/table1.png']
          },
          {
            id: '1.2',
            oldContent: null,
            newContent: 'This specification may be used in other non-heat treating applications when specified.',
            diffs: [{ type: 'added', value: 'This specification may be used in other non-heat treating applications when specified.' }],
            isNew: true,
            attachments: []
          },
          {
            id: '2.1',
            oldContent: 'ASTM Publications Available from ASTM International',
            newContent: 'SAE Publications Available from SAE International',
            diffs: [
              { type: 'removed', value: 'ASTM' },
              { type: 'added', value: 'SAE' },
              { type: 'unchanged', value: ' Publications Available from ' },
              { type: 'removed', value: 'ASTM' },
              { type: 'added', value: 'SAE' },
              { type: 'unchanged', value: ' International' }
            ],
            isNew: false,
            attachments: ['http://example.com/figure2.png']
          }
        ]
      });
    }, 2500);
  });
}

/**
 * Get the clause comparison export file.
 * @param {string} format 'excel' or 'csv'
 * @returns {Promise<any>}
 */
export function getClauseComparisonExport(format) {
  // return request({
  //   url: `/clause-comparison/export?format=${format}`,
  //   method: 'get',
  //   responseType: 'blob'
  // });

  return new Promise((resolve) => {
    setTimeout(() => {
      const mockFileUrl = format === 'excel' ? 'http://example.com/mock_comparison_result.xlsx' : 'http://example.com/mock_comparison_result.csv';
      resolve({
        code: 200,
        message: `${format} ファイルを生成しました`,
        data: {
          downloadUrl: mockFileUrl
        }
      });
    }, 1000);
  });
}
