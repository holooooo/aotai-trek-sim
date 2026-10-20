import AppKit
import CoreImage.CIFilterBuiltins
import Vision

let args = CommandLine.arguments
if args.count >= 4 && args[1] == "generate" {
    let filter = CIFilter.qrCodeGenerator()
    filter.message = Data(args[2].utf8)
    filter.correctionLevel = "M"
    guard let qr = filter.outputImage else { fatalError("QR generation failed") }
    let quiet = 4.0
    let extent = qr.extent.insetBy(dx: -quiet, dy: -quiet)
    let white = CIImage(color: CIColor.white).cropped(to: extent)
    let img = qr.composited(over: white).transformed(by: CGAffineTransform(scaleX: 12, y: 12))
    guard let cg = CIContext().createCGImage(img, from: img.extent) else { fatalError("QR rendering failed") }
    let rep = NSBitmapImageRep(cgImage: cg)
    try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
    print(args[2])
} else if args.count >= 3 && args[1] == "decode" {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try VNImageRequestHandler(url: URL(fileURLWithPath: args[2]), options: [:]).perform([request])
    for result in request.results ?? [] { print(result.payloadStringValue ?? "") }
} else {
    fatalError("generate URL PATH | decode IMAGE")
}
