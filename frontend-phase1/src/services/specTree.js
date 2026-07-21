import request from './index';

const MOCK_API_PREFIX = '/mock-api/spec-tree';

/**
 * Upload PDF files and generate a spec tree.
 * @param {FormData} data
 * @returns {Promise<any>}
 */
export function uploadPdfAndGenerateSpecTree(data) {
  // return request({
  //   url: '/spec-tree/generate',
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
        message: 'スペックツリーを生成しました',
        data: {
          mmd: `
graph TD
    A[Root Spec: M000378] --> B(Child Spec 1: ISAJT-P1TF9)
    A --> C(Child Spec 2: ASTM E4)
    B --> D(Sub-child 1.1: ISAJT-S219H)
    C --> E(Sub-child 2.1: AMS2750F)
    E --> F(Sub-child 2.1.1: ExampleDoc.pdf)
    D --> G(Grandchild 1.1.1: NestedSpec)
          `,
          excelUrl: 'http://example.com/spec-tree-output.xlsx',
          csvUrl: 'http://example.com/spec-tree-output.csv'
        }
      });
    }, 2000);
  });
}

/**
 * Get the spec tree export file.
 * @param {string} format 'excel' or 'csv'
 * @returns {Promise<any>}
 */
export function getSpecTreeExport(format) {
  // return request({
  //   url: `/spec-tree/export?format=${format}`,
  //   method: 'get',
  //   responseType: 'blob'
  // });

  return new Promise((resolve) => {
    setTimeout(() => {
      const mockFileUrl = format === 'excel' ? 'http://example.com/mock_spec_tree.xlsx' : 'http://example.com/mock_spec_tree.csv';
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
