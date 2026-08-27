import process from 'node:process'

const [requiredPlatform] = process.argv.slice(2)

if (!requiredPlatform) {
  throw new Error('A required Node.js platform must be specified')
}

if (process.platform !== requiredPlatform) {
  throw new Error(
    `This release target must be built on ${requiredPlatform}; current platform is ${process.platform}`,
  )
}
