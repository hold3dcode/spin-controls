/**
 * @author Eberhard Graether / http://egraether.com/
 * @author Mark Lundin 	/ http://mark-lundin.com
 * @author Simone Manini / http://daron1337.github.io
 * @author Luca Antiga 	/ http://lantiga.github.io
 * @author Paul Elliott / http://vizworkshop.com
 */

var SpinControls = function ( object, trackBallRadius, camera, domElement ) {

	var _this = this;

	this.object = object;
	this.trackballRadius = trackBallRadius;
	this.camera = camera;
	this.domElement = ( domElement !== undefined ) ? domElement : document;

	// API

	this.enabled = true;

	this.rotateSensitivity = 1.0; // Keep at 1 for direct touching feel
	this.relativelySpinOffTrackball = true;
	this.enableDamping = true;
	this.dampingFactor = 5; // Increase for more friction
	this.spinAxisConstraint; // Set to a THREE.Vector3 to limit spinning to an axis

	// Raycast projects pointer line through camera frustum for accurate trackball control. 
	// Shoemake has direct touching feel of pointer on orthographically projected sphere but jumps at sphere edge.
	// Holyroyd smooths between sphere and hyperbola to avoid jump at sphere edge.
	// Azimuthal from Yasuhiro Fujii has unlimited rotation behond the sphere edge.
	this.POINTER_SPHERE_MAPPING = { SHOEMAKE: 0, HOLROYD: 1, AZIMUTHAL: 2, RAYCAST: 3};
	this.rotateAlgorithm = this.POINTER_SPHERE_MAPPING.RAYCAST;

	// Internals

	this.screen = { left: 0, top: 0, width: 0, height: 0 };

	var _angularVelocity = new THREE.Vector3(0, 0, 0),
		_lastQuaternion = new THREE.Quaternion(),
		_lastVelTime,

		_pointOnSphere = new THREE.Vector3(),
		_pointerScreen = new THREE.Vector2(),
		_pointOnSphereOld = new THREE.Vector3(),
		_lastPointerEventTime = 0,
		_wasLastPointerEventOnSphere = false,

		_isPointerDown = false,

		_OFF_TRACKBALL_VELOCITY_GAIN = 8.0, // ToDo: Base this on angle change around sphere edge?
		_EPS = 0.000001;

	var changeEvent = { type: 'change' };
	var startEvent = { type: 'start' };
	var endEvent = { type: 'end' };

	this.update = ( function () {

		var currentTime;
		var lastTime = performance.now() / 1000.0;
		var deltaTime;

		return function update() {

			currentTime = performance.now() / 1000.0;
			deltaTime = currentTime - lastTime;
			lastTime = currentTime;

			if( !_isPointerDown && _this.enableDamping ) {

				_angularVelocity.multiplyScalar( 1 / ( deltaTime * _this.dampingFactor + 1 ) );

				_this.applyVelocity();

			}

			if( !_this.enableDamping ) {

				_lastVelTime = performance.now(); // ToDo Avoid this hack.  Causes trackball drift.

			}
			
			_this.hasPointerMovedThisFrame = false;

		};

	}() );


	this.updateAngularVelocity = ( function () {

		var q0 = new THREE.Quaternion(),
			q1 = new THREE.Quaternion(),
			q0Conj = new THREE.Quaternion(); //for path independent rotation

		return function updateAngularVelocity( p1, p0, timeDelta ) {

			// path independent rotation from Shoemake
			q0Conj.set(p0.x, p0.y, p0.z, 0.0)
			q0Conj.normalize();
			q0Conj.conjugate();
			q1.set(p1.x, p1.y, p1.z, 0.0).multiply(q0Conj); 
			timeDelta *= 2.0; // divide angleDelta by 2 to keep sphere under pointer.  Might break algorithm properties, TODO: perhaps investigate.
			
			// path dependent
			// q1.setFromUnitVectors(p0, p1);
			
			q0.set(p0.x, p0.y, p0.z, 1.0);
			angleSpeed = q1.angleTo(q0) / timeDelta;			

			// Just set velocity because we are touching trackball without sliding
			_angularVelocity.crossVectors( p0, p1);
			_angularVelocity.setLength( angleSpeed );
			_this.applyVelocity();

		};

	}() );


	this.applyVelocity = ( function () {

		var quat = new THREE.Quaternion(),
			normalizedAxis = new THREE.Vector3(),
			deltaAngle,
			deltaTime,
			timeStamp;

		return function applyVelocity() {

			timeStamp = performance.now();
			deltaTime = ( timeStamp - _lastVelTime ) / 1000.0;
			_lastVelTime = timeStamp;

			if( _this.spinAxisConstraint ) {

				normalizedAxis.copy( _this.spinAxisConstraint );
				deltaAngle = normalizedAxis.dot( _angularVelocity ) ;

			} else {

				normalizedAxis.copy( _angularVelocity );
				deltaAngle = _angularVelocity.length();

			}

			if ( deltaAngle && deltaTime ) {

				normalizedAxis.normalize();
				quat.setFromAxisAngle( normalizedAxis, deltaAngle * deltaTime * _this.rotateSensitivity );

				_this.object.quaternion.normalize();
				_this.object.quaternion.premultiply(quat);

				// using small-angle approximation cos(x/2) = 1 - x^2 / 8

				if ( 8 * ( 1 - _lastQuaternion.dot( _this.object.quaternion ) ) > _EPS) {

					_this.dispatchEvent( changeEvent );

					_lastQuaternion.copy( _this.object.quaternion );

				}

			}

		};

	}() );

	this.onWindowResize = ( function () {

		if ( _this.domElement === document ) {

			_this.screen.left = 0;
			_this.screen.top = 0;
			_this.screen.width = window.innerWidth;
			_this.screen.height = window.innerHeight;

		} else {

			var box = _this.domElement.getBoundingClientRect();
			var d = _this.domElement.ownerDocument.documentElement;
			_this.screen.left = box.left + window.pageXOffset - d.clientLeft;
			_this.screen.top = box.top + window.pageYOffset - d.clientTop;
			_this.screen.width = box.width;
			_this.screen.height = box.height;

		}

	} );


	this.resetInputAfterCameraMovement = ( function () {
		
		if( _isPointerDown ) {

			// Need to update camera.matrixWorldInverse if camera is moved 
			// and renderer has not updated matrixWorldInverse yet.
			_this.camera.updateWorldMatrix(true, false);
			_this.camera.matrixWorldInverse.copy( _this.camera.matrixWorld ).invert();

			_pointOnSphere.copy( getPointerInSphere( getPointerInNdc( _pointerScreen.x, _pointerScreen.y ) ) );
		}
		
	} );

	var getPointerInNdc = ( function () {

		var vector = new THREE.Vector2();

		return function getPointerInNdc( pageX, pageY ) {

			vector.set(
				( pageX - _this.screen.width * 0.5 - _this.screen.left ) / ( _this.screen.width * 0.5 ),
				( _this.screen.height + 2 * ( _this.screen.top - pageY ) ) / _this.screen.height
			);

			return vector;

		};

	}() );

	// Find vector from object to pointer in screen space
	var getObjectToPointer = ( function () { 

		var objPos = new THREE.Vector3(),
			objEdgePos = new THREE.Vector3(),
			offset = new THREE.Vector3(),
			objToPointer = new THREE.Vector2(),
			cameraRot = new THREE.Quaternion();

		return function getObjectToPointer( pointerNdcScreen ) {
			
			_this.object.updateWorldMatrix( true, false );
			objPos.setFromMatrixPosition( _this.object.matrixWorld );
			_this.camera.updateWorldMatrix( true, false );
			// Need to update camera.matrixWorldInverse if camera moved before renderer.render
			_this.camera.matrixWorldInverse.copy( _this.camera.matrixWorld ).invert();
			objPos.project( _this.camera ); // position in ndc/screen			
			objToPointer.set( objPos.x, objPos.y ); 
			objToPointer.subVectors( pointerNdcScreen, objToPointer ); 

			// Normalize objToPointer by object screen size
			// so objToPointer of lenght 1 is 1 object radius distance from object center.
			// Should we simplify if Orthographic camera?
			objEdgePos.setFromMatrixPosition( _this.object.matrixWorld ); // objEdgePos is still aspirational on this line
			offset.set( _this.trackballRadius, 0, 0 );

			offset.applyQuaternion( cameraRot.setFromRotationMatrix( _this.camera.matrixWorld ) );
			objEdgePos.add( offset );
			objEdgePos.project( _this.camera ); // position in ndc/screen
			objEdgePos.z = 0;
			objPos.z = 0;
			var objRadiusNDC = objEdgePos.distanceTo( objPos );

			objToPointer.x /= objRadiusNDC;
			objToPointer.y /= objRadiusNDC;
			if ( _this.camera.aspect ) { // Perspective camera probably
				objToPointer.y /= _this.camera.aspect;
			}

			return objToPointer;

		}
	}() );

	// Finds point on sphere in world coordinate space
	var getPointerInSphere = ( function () {

		var point = new THREE.Vector3(),
			objPos = new THREE.Vector3(),
			objToPointer = new THREE.Vector2(),
			cameraRot = new THREE.Quaternion(),
			trackBallSphere = new THREE.Sphere(),
			ray = new THREE.Ray();

		return function getPointerInSphere( ndc ) {

			objToPointer.copy( getObjectToPointer( ndc ) );

			cameraRot.setFromRotationMatrix( _this.camera.matrixWorld );

			if ( _this.rotateAlgorithm === _this.POINTER_SPHERE_MAPPING.RAYCAST ) {

				if ( objToPointer.lengthSq() < 1 ) {

					objPos.setFromMatrixPosition( _this.object.matrixWorld );
					trackBallSphere.set( objPos, _this.trackballRadius );

					ray.origin.copy( _this.camera.position );
					ray.direction.set( ndc.x, ndc.y, .5 );
					ray.direction.unproject( _this.camera ); // In world space
					ray.direction.sub( _this.camera.position ).normalize(); // Subtract to put around origin

					ray.intersectSphere( trackBallSphere, point );
					point.sub( objPos );
					point.normalize(); // updateAngularVelocity expects unit vectors

				} else {

					// Shoemake project on edge of sphere
					objToPointer.normalize();
					point.set( objToPointer.x, objToPointer.y, 0.0 );
					point.applyQuaternion( cameraRot );
					
				}

			}
			// Pointer mapping code below derived from Yasuhiro Fujii's https://mimosa-pudica.net/3d-rotation/
			else if ( _this.rotateAlgorithm === _this.POINTER_SPHERE_MAPPING.HOLROYD ) {

				var t = objToPointer.lengthSq();
				if (t < 0.5) {
					point.set( objToPointer.x, objToPointer.y, Math.sqrt( 1.0 - t ) );
				} else {
					point.set( objToPointer.x, objToPointer.y, 1.0 / ( 2.0 * Math.sqrt( t ) ) );
					point.normalize();
				}
				point.applyQuaternion( cameraRot ); // Rotate from looking down z axis to camera direction

			} else if ( _this.rotateAlgorithm === _this.POINTER_SPHERE_MAPPING.SHOEMAKE ) {
				
				var t = objToPointer.lengthSq();
				if (t < 1.0) {
					point.set( objToPointer.x, objToPointer.y, Math.sqrt( 1.0 - t ) );
				} else {
					objToPointer.normalize();
					point.set( objToPointer.x, objToPointer.y, 0.0 );
				}
				point.applyQuaternion( cameraRot );

			} else if ( _this.rotateAlgorithm === _this.POINTER_SPHERE_MAPPING.AZIMUTHAL ) {
				
				var t = ( Math.PI / 2.0 ) * objToPointer.length();
				var sined = t < Number.EPSILON ? 1.0 : Math.sin( t ) / t;
				objToPointer.multiplyScalar( ( Math.PI / 2.0 ) * sined );
				point.set( objToPointer.x, objToPointer.y, Math.cos( t ) );
				point.applyQuaternion( cameraRot );

			}
			
			return point;

		};

	}() );
	
	this.onPointerDown = function( pointerScreenX, pointerScreenY ) {

		var pointerNdc = getPointerInNdc( pointerScreenX, pointerScreenY );

		var objToPointer = getObjectToPointer( pointerNdc );

		if ( objToPointer.lengthSq() < 1 ) {

			_wasLastPointerEventOnSphere = true;
			_pointOnSphere.copy( getPointerInSphere( pointerNdc ) );

		} else {

			_wasLastPointerEventOnSphere = false;
			
		}

		_pointerScreen.set( pointerScreenX, pointerScreenY );
		_lastPointerEventTime = performance.now();
		_angularVelocity.set( 0, 0, 0 );
		_isPointerDown = true;

	}

		// Finds point on sphere in world coordinate space
	this.onPointerMove = ( function () {

		var pointerNdc = new THREE.Vector3(),
			objToPointer = new THREE.Vector2();

		// for relative movement off sphere
		var deltaMouse = new THREE.Vector2(),
			lastNdc = new THREE.Vector2(),
			objectPos = new THREE.Vector3(),
			objectToCamera = new THREE.Vector3(),
			polarVel = new THREE.Vector3(),
			lastPointOnSphere = new THREE.Vector3();
	
		return function onPointerMove( pointerScreenX, pointerScreenY ) {

			var currentTime = performance.now();
			var deltaTime = ( currentTime - _lastPointerEventTime ) / 1000.0;
			_lastPointerEventTime = currentTime;
			
			_pointOnSphereOld.copy( _pointOnSphere );
			
			pointerNdc.copy( getPointerInNdc( pointerScreenX, pointerScreenY ) );

			objToPointer.copy( getObjectToPointer( pointerNdc ) )

			if ( objToPointer.lengthSq() < 1 || !this.relativelySpinOffTrackball) {
				// Pointer is within radius of object trackball circle on screen

				_pointOnSphere.copy( getPointerInSphere( pointerNdc ) );

				if ( _wasLastPointerEventOnSphere ) {

					// Still on sphere
					if( deltaTime > 0 ) { // Sometimes zero due to timer precision?			

						_this.updateAngularVelocity( _pointOnSphere, _pointOnSphereOld, deltaTime );
			
					}
					
				} 
				else { 

					// Moved on sphere 
					_angularVelocity.set( 0, 0, 0 );
					_lastVelTime = currentTime;

				}

				_wasLastPointerEventOnSphere = true;
			
			} else {

				if ( _wasLastPointerEventOnSphere ) {

					// Moved off sphere 
					_angularVelocity.set( 0, 0, 0 );
					_lastVelTime = currentTime;
					
				} 
				else { 

					// Still off sphere
					
					if( deltaTime > 0 ) { // Sometimes zero due to timer precision?		
						
						// Relative movement
						//ToDo: Simplify by find pointer's delta polar coordinates with THREE.Sphere?

						lastNdc.copy( getPointerInNdc( _pointerScreen.x, _pointerScreen.y ) );
						
						deltaMouse.subVectors(pointerNdc, lastNdc);

						// Find change in pointer radius to trackball center
						objectPos.setFromMatrixPosition( _this.object.matrixWorld );
						objectToCamera.copy( _this.camera.position ).sub( objectPos );
					
						var ndcPerBall = ( 1 / ( _this.camera.fov / 2 ) ) // NDC per field of view degree
							/ ( Math.atan( _this.trackballRadius / objectToCamera.length() ) ); // Ball angle size

						objToPointer.normalize();

						var deltaRadius = deltaMouse.dot( objToPointer ) * ndcPerBall / deltaTime * _OFF_TRACKBALL_VELOCITY_GAIN;

						lastPointOnSphere.copy( getPointerInSphere( lastNdc ) );

						_pointOnSphere.copy( getPointerInSphere( pointerNdc ) );

						_angularVelocity.crossVectors( objectToCamera, _pointOnSphere );
						_angularVelocity.setLength( deltaRadius ); // Just set it because we are touching trackball without sliding

						// Find polar angle change
						angle = lastPointOnSphere.angleTo( _pointOnSphere ) / deltaTime;
						polarVel.crossVectors( lastPointOnSphere, _pointOnSphere );
						polarVel.setLength( angle ); 

						_angularVelocity.add( polarVel );
						
						_this.applyVelocity();
				
					}				

				}

				_wasLastPointerEventOnSphere = false;

			}

			_pointerScreen.set( pointerScreenX, pointerScreenY );
			
			_this.hasPointerMovedThisFrame = true;

		}
	}() );

	// listeners

	this.handlePointerDown = function ( event ) {

		event.preventDefault(); // Prevent the browser from scrolling.
		event.stopImmediatePropagation(); // Stop other controls working.

		// Manually set the focus since calling preventDefault above
		// prevents the browser from setting it automatically.
		_this.domElement.focus ? _this.domElement.focus() : window.focus();
		
		_this.dispatchEvent( startEvent );

	}

	this.handlePointerUp = function ( event ) {

		event.preventDefault();
		
		_isPointerDown = false;

		_this.dispatchEvent( endEvent );

	}

	function onMouseDown( event ) {

		if ( _this.enabled === false || event.button !== 0 ) return;
		
		_this.onPointerDown( event.pageX, event.pageY );

		document.addEventListener( 'mousemove', onMouseMove, false );
		document.addEventListener( 'mouseup', onMouseUp, false );

		_this.handlePointerDown( event );

	}

	function onMouseMove( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();

		_this.onPointerMove( event.pageX, event.pageY );

	}

	function onMouseUp( event ) {

		if ( _this.enabled === false ) return;

		if( !_this.hasPointerMovedThisFrame || !_this.enableDamping ) {
			_angularVelocity.set( 0, 0, 0 );
		}

		document.removeEventListener( 'mousemove', onMouseMove );
		document.removeEventListener( 'mouseup', onMouseUp );

		_this.handlePointerUp( event );

	}

	// For camera controls to stop spin with 2 finger pinch
	this.cancelSpin = ( function () {
		
		_angularVelocity.set( 0, 0, 0 );

	} );

	// Function broken out for CameraSpinControls to use in touch end if going from 2 fingers to 1
	this.handleTouchStart = function( event ) {
		
		_this.onPointerDown( event.pageX, event.pageY );
		_this.applyVelocity();  //TODO Should not be needed here

	}

	function onTouchStart( event ) {

		if ( _this.enabled === false ) return;

		_this.handleTouchStart( event );

		_this.handlePointerDown( event );

	}

	function onTouchMove( event ) {
		
		if ( _this.enabled === false || !_isPointerDown ) return;

		event.preventDefault();
		event.stopImmediatePropagation(); // Prevent other controls from working.

		_this.onPointerMove( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

	}

	function onTouchEnd( event ) {

		if( _this.enabled === false || !_isPointerDown ) return;

		if( !_this.hasPointerMovedThisFrame ) {
			
			// To support subtle touches do big dampening, not zeroing it
			var deltaTime = ( performance.now() - _lastPointerEventTime ) / 1000.0;
			_angularVelocity.multiplyScalar( 1 / ( 10 * deltaTime * _this.dampingFactor + 1 ) ) 
		
		}

		_this.handlePointerUp( event );

	}

	this.dispose = function () {

		_this.domElement.removeEventListener( 'resize', onWindowResize );

		_this.domElement.removeEventListener( 'mousedown', onMouseDown );
		document.removeEventListener( 'mousemove', onMouseMove );
		document.removeEventListener( 'mouseup', onMouseUp );

		_this.domElement.removeEventListener( 'touchstart', onTouchStart );		
		_this.domElement.removeEventListener( 'touchmove', onTouchMove );
		_this.domElement.removeEventListener( 'touchend', onTouchEnd );

	};

	_this.domElement.addEventListener( 'resize', onWindowResize );	
	_this.domElement.addEventListener( 'mousedown', onMouseDown );

	_this.domElement.addEventListener( 'touchstart', onTouchStart, {passive: false} );
	_this.domElement.addEventListener( 'touchmove', onTouchMove, {passive: false} );
	_this.domElement.addEventListener( 'touchend', onTouchEnd, {passive: false} );

	_this.onWindowResize();
	// force an update at start
	_this.update();

};

SpinControls.prototype = Object.create( THREE.EventDispatcher.prototype );
SpinControls.prototype.constructor = SpinControls;