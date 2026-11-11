// Turns a simulator's JPEG frames into small raw pictures a terminal can draw.
// stdin:  [u32 length][u32 widest side wanted, in pixels][JPEG bytes], big-endian, one per frame.
// stdout: [u32 width][u32 height][width * height * 4 bytes of RGBA], one per frame; 0 x 0 for a frame it couldn't read.
// Built once with `swiftc -O` (see screen-term.mjs). ImageIO decodes at the size asked for, so a
// full-size frame costs a few milliseconds.
import Foundation
import ImageIO
import CoreGraphics

let input = FileHandle.standardInput, output = FileHandle.standardOutput

func readExactly(_ n: Int) -> Data? {
  var data = Data()
  while data.count < n {
    let chunk = input.readData(ofLength: n - data.count)
    if chunk.isEmpty { return nil }
    data.append(chunk)
  }
  return data
}

func u32(_ d: Data) -> Int { d.reduce(0) { ($0 << 8) | Int($1) } }
func be(_ v: Int) -> Data { Data([UInt8((v >> 24) & 255), UInt8((v >> 16) & 255), UInt8((v >> 8) & 255), UInt8(v & 255)]) }

while let head = readExactly(8) {
  let length = u32(head.prefix(4)), side = u32(head.suffix(4))
  guard let jpeg = readExactly(length) else { break }
  let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: side, kCGImageSourceShouldCacheImmediately: true]
  guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
        let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { output.write(be(0) + be(0)); continue }
  let w = image.width, h = image.height
  var rgba = Data(count: w * h * 4)
  let drawn = rgba.withUnsafeMutableBytes { buffer -> Bool in
    guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return true
  }
  guard drawn else { output.write(be(0) + be(0)); continue }
  output.write(be(w) + be(h) + rgba)
}
