(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module unless amdModuleId is set
    define([], function () {
      return (root['SignaturePad'] = factory());
    });
  } else if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    root['SignaturePad'] = factory();
  }
}(this, function () {

/*!
 * Signature Pad v2.0 by Stephan Brunker
 * forked from
 * https://github.com/szimek/signature_pad v1.5.3
 *
 * Copyright 2016 Szymon Nowak / 2017 Stephan Brunker
 * Released under the MIT license
 *
 * The main idea and some parts of the code (e.g. drawing variable width Bézier curve) are taken from:
 * http://corner.squareup.com/2012/07/smoother-signatures.html
 *
 * Implementation of interpolation using cubic Bézier curves is taken from:
 * http://benknowscode.wordpress.com/2012/09/14/path-interpolation-using-cubic-bezier-and-control-point-estimation-in-javascript
 *
 * Algorithm for approximated length of a Bézier curve is taken from:
 * http://www.lemoda.net/maths/bezier-length/index.html
 *
 * A lot of comments added and the functions ordered for better understandability
 * and some minor improvements by Stephan Brunker
 * 
 */
var SignaturePad = (function (document) {
    "use strict";

    var SignaturePad = function (canvas, options) {
        var self = this,
            opts = options || {};

        this.velocityFilterWeight = opts.velocityFilterWeight || 0.7;
        this.minWidth = opts.minWidth || 1;
        this.maxWidth = opts.maxWidth || 2.5;
        
        this.penColor = opts.penColor || "black";
        this.backgroundColor = opts.backgroundColor || "rgba(0,0,0,0)";
        this.onEnd = opts.onEnd;
        this.onBegin = opts.onBegin;

        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
        this.clear();

        // we need add these inline so they are available to unbind while still having
        //  access to 'self' we could use _.bind but it's not worth adding a dependency
        this._handleMouseDown = function (event) {
            if (event.which === 1) {
                self._mouseButtonDown = true;
                self._strokeBegin(event);
            }
        };

        this._handleMouseMove = function (event) {
            if (self._mouseButtonDown) {
                self._strokeUpdate(event);
            }
        };

        this._handleMouseUp = function (event) {
            if (event.which === 1 && self._mouseButtonDown) {
                self._mouseButtonDown = false;
                self._strokeEnd(event);
            }
        };

        this._handleTouchStart = function (event) {
            if (event.targetTouches.length == 1) {
                var touch = event.changedTouches[0];
                self._strokeBegin(touch);
             }
        };

        this._handleTouchMove = function (event) {
            // Prevent scrolling.
            event.preventDefault();

            var touch = event.targetTouches[0];
            self._strokeUpdate(touch);
        };

        this._handleTouchEnd = function (event) {
            var wasCanvasTouched = event.target === self._canvas;
            if (wasCanvasTouched) {
                event.preventDefault();
                self._strokeEnd(event);
            }
        };

        this._handleMouseEvents();
        this._handleTouchEvents();
    };

	// Event Listener
    SignaturePad.prototype._handleMouseEvents = function () {
        this._mouseButtonDown = false;

        this._canvas.addEventListener("mousedown", this._handleMouseDown);
        this._canvas.addEventListener("mousemove", this._handleMouseMove);
        document.addEventListener("mouseup", this._handleMouseUp);
    };

    SignaturePad.prototype._handleTouchEvents = function () {
        // Pass touch events to canvas element on mobile IE.
        this._canvas.style.msTouchAction = 'none';
		this._canvas.style.touchAction = 'none';

        this._canvas.addEventListener("touchstart", this._handleTouchStart);
        this._canvas.addEventListener("touchmove", this._handleTouchMove);
        this._canvas.addEventListener("touchend", this._handleTouchEnd);
    };

    SignaturePad.prototype.on = function () {
        this._handleMouseEvents();
        this._handleTouchEvents();
    };

    SignaturePad.prototype.off = function () {
        this._canvas.removeEventListener("mousedown", this._handleMouseDown);
        this._canvas.removeEventListener("mousemove", this._handleMouseMove);
        document.removeEventListener("mouseup", this._handleMouseUp);

        this._canvas.removeEventListener("touchstart", this._handleTouchStart);
        this._canvas.removeEventListener("touchmove", this._handleTouchMove);
        document.removeEventListener("touchend", this._handleTouchEnd);
    };

    SignaturePad.prototype.isEmpty = function () {
        return this._isEmpty;
    };

    
    // kind of an constructor for the member variables
    SignaturePad.prototype._reset = function () {
        this.points = [];
        this._lastVelocity = 0;
        this._lastWidth = (this.minWidth + this.maxWidth) / 2;
        this._isEmpty = true;
        this._ctx.fillStyle = this.penColor;
    };

    SignaturePad.prototype.clear = function () {
        var ctx = this._ctx,
            canvas = this._canvas;

        ctx.fillStyle = this.backgroundColor;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this._reset();
    };

	//========================================================================
	
	// Import and Export Bitmap
    SignaturePad.prototype.toDataURL = function (imageType, quality) {
        var canvas = this._canvas;
        return canvas.toDataURL.apply(canvas, arguments);
    };

    SignaturePad.prototype.fromDataURL = function (dataUrl) {
        var self = this,
            image = new Image(),
            ratio = window.devicePixelRatio || 1,
            width = this._canvas.width / ratio,
            height = this._canvas.height / ratio;

        this._reset();
        image.src = dataUrl;
        image.onload = function () {
            self._ctx.drawImage(image, 0, 0, width, height);
        };
        this._isEmpty = false;
    };

	//========================================================================
	//   User-Defined Types
	//========================================================================

	// UDT Variable POINT
    var Point = function (x, y, time) {
        this.x = x;
        this.y = y;
        this.time = time || new Date().getTime();
    };
    
		// Returns the velocity to this point from start point
        Point.prototype.velocityFrom = function (start) {
			if ( this.distanceTo(start) === 0 ) { return 0; }
			else return (this.time !== start.time) ? this.distanceTo(start) / (this.time - start.time) : 1;
		};

		Point.prototype.distanceTo = function (start) {
			return Math.sqrt(Math.pow(this.x - start.x, 2) + Math.pow(this.y - start.y, 2));
		};

	// UDT Variable BEZIER
    var Bezier = function (startPoint, control1, control2, endPoint) {
        this.startPoint = startPoint;
        this.control1 = control1;
        this.control2 = control2;
        this.endPoint = endPoint;
    };
    
		// Returns approximated length.
		Bezier.prototype.length = function () {
			var steps = 10,
				length = 0,
				i, t, cx, cy, px, py, xdiff, ydiff;

			for (i = 0; i <= steps; i++) {
				t = i / steps;
				cx = this._point(t, this.startPoint.x, this.control1.x, this.control2.x, this.endPoint.x);
				cy = this._point(t, this.startPoint.y, this.control1.y, this.control2.y, this.endPoint.y);
				if (i > 0) {
					xdiff = cx - px;
					ydiff = cy - py;
					length += Math.sqrt(xdiff * xdiff + ydiff * ydiff);
				}
				px = cx;
				py = cy;
			}
			return length;
		};

		Bezier.prototype._point = function (t, start, c1, c2, end) {
			return          start * (1.0 - t) * (1.0 - t)  * (1.0 - t)
				   + 3.0 *  c1    * (1.0 - t) * (1.0 - t)  * t
				   + 3.0 *  c2    * (1.0 - t) * t          * t
				   +        end   * t         * t          * t;
		};

	//========================================================================
	//		Processing Drawing events for Input events
	//========================================================================

	// TouchStart or MouseDown
    SignaturePad.prototype._strokeBegin = function (event) {
        this._reset();
        this._strokeUpdate(event);
        // event of MouseDown is same point as first MouseMove
        if (typeof this.onBegin === 'function') {
            this.onBegin(event);
        }
    };

	// TouchMove or MouseMove
    SignaturePad.prototype._strokeUpdate = function (event) {
        var point = this._createPoint(event);
        this._addPoint(point);
    };


	// TouchEnd or MouseUp - end of Stroke
    SignaturePad.prototype._strokeEnd = function (event) {
		// event of Mouse Up is same point as last MouseMove
		// Points Array can have four Members (Bezier drawn) or two (nothing drawn) or one (single Click)
		var points = this.points;
		
		// shift array left if filled
		switch (points.length) {
			case 4:
				// double the last point to finish the stroke
				this._addPoint(points[4]);
				break;
			case 2:
				// connect with a line
				this._drawLine(points[0],points[1]);
				break;
			case 1:
				// single click - draw a dot
				this._drawDot(points[0]);
				break;
		}

        if (typeof this.onEnd === 'function') {
            this.onEnd(event);
        }
    };
    
    SignaturePad.prototype._strokeDot = function (event) {
		var point = this._createPoint(event);
		this._reset();
		
		if (typeof this.onBegin === 'function') {
            this.onBegin(event);
        }
		
		this._drawDot(point);
		
		if (typeof this.onEnd === 'function') {
            this.onEnd(event);
        }
		
	}
	

	//========================================================================
	//   Drawing a Bezier Line
	//========================================================================

	// add a new Point to the points array, calculate the bezier between P1 and P2 
    SignaturePad.prototype._addPoint = function (point) {
        var points = this.points,
            c2, c3,
            curve, tmp;

        points.push(point);

        if (points.length > 2) {
            // To reduce the initial lag make it work with 3 points
            // by copying the first point to the beginning.
            if (points.length === 3) points.unshift(points[0]);

            tmp = this._calculateCurveControlPoints(points[0], points[1], points[2]);
            c2 = tmp.c2;
            tmp = this._calculateCurveControlPoints(points[1], points[2], points[3]);
            c3 = tmp.c1;
            curve = new Bezier(points[1], c2, c3, points[2]);
            
			var velocity, newWidth;
			velocity = points[2].velocityFrom(points[1]);
			velocity = this.velocityFilterWeight * velocity
				+ (1 - this.velocityFilterWeight) * this._lastVelocity;

			newWidth = this._strokeWidth(velocity);
			this._drawCurve(curve, this._lastWidth, newWidth);

			this._lastVelocity = velocity;
			this._lastWidth = newWidth;

            // Remove the first element from the list,
            // so that we always have no more than 4 points in points array.
            points.shift();
        }
    };

	// Draw Curve to Canvas
    SignaturePad.prototype._drawCurve = function (curve, startWidth, endWidth) {
        var ctx = this._ctx,
            widthDelta = endWidth - startWidth,
            drawSteps, width, i, t, tt, ttt, u, uu, uuu, x, y;

        drawSteps = Math.floor(curve.length());
        ctx.beginPath();
        for (i = 0; i < drawSteps; i++) {
            // Calculate the Bezier (x, y) coordinate for this step.
            t = i / drawSteps;
            tt = t * t;
            ttt = tt * t;
            u = 1 - t;
            uu = u * u;
            uuu = uu * u;

            x = uuu * curve.startPoint.x;
            x += 3 * uu * t * curve.control1.x;
            x += 3 * u * tt * curve.control2.x;
            x += ttt * curve.endPoint.x;

            y = uuu * curve.startPoint.y;
            y += 3 * uu * t * curve.control1.y;
            y += 3 * u * tt * curve.control2.y;
            y += ttt * curve.endPoint.y;

            width = startWidth + ttt * widthDelta;
            this._drawPoint(x, y, width);
        }
        ctx.closePath();
        ctx.fill();
    };

	//========================================================================
	//		Drawing a Single Dot
	//========================================================================

    SignaturePad.prototype._drawDot = function (point) {
        var ctx = this._ctx,
          //  dotSize = typeof(this.dotSize) === 'function' ? this.dotSize() : this.dotSize
          dotSize = this.maxWidth;

        ctx.beginPath();
        this._drawPoint(point.x, point.y, dotSize);
        ctx.closePath();
        ctx.fill();
    };

	//========================================================================
	//		Drawing a Line
	//========================================================================

    SignaturePad.prototype._drawLine = function ( startPoint, endPoint ) {
		var ctx = this._ctx,velocity,newWidth,drawSteps,i,x,y, 
			dx = endPoint.x - startPoint.x, dy = endPoint.y - startPoint.y,
			width,widthDelta;
			
		velocity = endPoint.velocityFrom(startPoint);
		velocity = this.velocityFilterWeight * velocity
			+ (1 - this.velocityFilterWeight) * this._lastVelocity;

		newWidth = this._strokeWidth(velocity);
		widthDelta = newWidth - this._lastWidth;
		
		drawSteps = Math.floor(endPoint.distanceTo(startPoint));
		ctx.beginPath();
        for (i = 0; i < drawSteps; i++) {
			x = startPoint.x + (dx * i / drawSteps);
			y = startPoint.y + (dy * i / drawSteps);
			width = this._lastWidth + (widthDelta * i / drawSteps);
			this._drawPoint(x, y, width);
		}
		ctx.closePath();
        ctx.fill();
        
		this._lastVelocity = velocity;
		this._lastWidth = newWidth;			
		
	};
	
	//========================================================================
	//		All drawings are made by lining up a lot of single points
	//========================================================================	
	
    SignaturePad.prototype._drawPoint = function (x, y, size) {
        var ctx = this._ctx;

        ctx.moveTo(x, y);
        ctx.arc(x, y, size, 0, 2 * Math.PI, false);
        this._isEmpty = false;
    };	
	
	
	//========================================================================
	//		Helper Functions
	//========================================================================

	// Event to POINT converter
    SignaturePad.prototype._createPoint = function (event) {
        var rect = this._canvas.getBoundingClientRect();
        return new Point(
            event.clientX - rect.left,
            event.clientY - rect.top
        );
    };

	// ControlPoint Calculation
    SignaturePad.prototype._calculateCurveControlPoints = function (s1, s2, s3) {
        var dx1 = s1.x - s2.x, dy1 = s1.y - s2.y,
            dx2 = s2.x - s3.x, dy2 = s2.y - s3.y,

            m1 = {x: (s1.x + s2.x) / 2.0, y: (s1.y + s2.y) / 2.0},
            m2 = {x: (s2.x + s3.x) / 2.0, y: (s2.y + s3.y) / 2.0},

            l1 = Math.sqrt(dx1*dx1 + dy1*dy1),
            l2 = Math.sqrt(dx2*dx2 + dy2*dy2),

            dxm = (m1.x - m2.x),
            dym = (m1.y - m2.y),

            k = l2 / (l1 + l2),
            cm = {x: m2.x + dxm*k, y: m2.y + dym*k},

            tx = s2.x - cm.x,
            ty = s2.y - cm.y;

        return {
            c1: new Point(m1.x + tx, m1.y + ty),
            c2: new Point(m2.x + tx, m2.y + ty)
        };
    };

	// stroke width calculation from velocity
    SignaturePad.prototype._strokeWidth = function (velocity) {
        return Math.max(this.maxWidth / (velocity + 1), this.minWidth);
    };


    return SignaturePad;
})(document);

return SignaturePad;

}));
