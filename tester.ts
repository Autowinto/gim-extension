import type { AxiosResponse } from 'axios'
import type { Stream } from 'node:stream'
import axios from 'axios'

// Define the expected structure of the data payload
interface DocstringRequestPayload {
  file_name: string
  signature: string
  model_name: string
}

// Update fetchData to accept the data payload
async function fetchData(url: string, data: DocstringRequestPayload): Promise<AxiosResponse<Stream>> {
  try {
    const response: AxiosResponse<Stream> = await axios.post(
      url,
      data, // <-- Pass the required data here
      {
        responseType: 'stream',
      },
    )
    // Return the full response object, which contains the stream in response.data
    return response
  }
  catch (error) {
    console.error('Error fetching data:', error)
    throw error
  }
}

async function processData(): Promise<any> {
  const url = 'http://127.0.0.1:9999/docstring'

  // 💡 Create the payload that the server expects
  const requestBody: DocstringRequestPayload = {
    file_name: '/Users/sandbye/Documents/GitHub/gim-extension/demo-sln/DemoLib/Class1.cs',
    signature: 'DemoLib.Calculator.Add(int, int)',
    model_name: 'deepseek-r1:1.5b',
  }

  // Pass both the URL and the request body
  const response = await fetchData(url, requestBody)

  // The stream is in response.data. You should attach event listeners
  // (like 'data', 'end', 'error') to process the stream data here,
  // since this endpoint is streaming the response.
  const stream = response.data

  // NOTE: You cannot simply return 'response.data' in processData()
  // if you want to use the console.warn callback, as stream processing is asynchronous.
  // You would typically handle the streaming logic here or return a Promise
  // that resolves when the stream ends.

  return new Promise((resolve, reject) => {
    let fullResponse = ''
    stream.on('data', (chunk: Buffer) => {
      // For a non-VS Code environment, just aggregate the data
      const data = chunk.toString('utf-8').replaceAll('data: ', '').trim()
      console.warn('Received chunk:', data)
      fullResponse += JSON.parse(data).token // Adjust based on actual data structure
    })

    stream.on('end', () => {
      resolve(fullResponse)
    })

    stream.on('error', (err) => {
      reject(err)
    })
  })
}

// The rest of your invocation logic remains the same
processData().then((data) => {
  console.warn('Data finished', data)
}).catch((error) => {
  console.error('Error processing data:', error)
})
